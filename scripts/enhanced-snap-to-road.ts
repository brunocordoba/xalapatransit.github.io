import { drizzle } from 'drizzle-orm/neon-serverless';
import { eq } from 'drizzle-orm';
import { Pool, neonConfig } from '@neondatabase/serverless';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import ws from 'ws';

// Configurar WebSocket para Neon
neonConfig.webSocketConstructor = ws;

// ESM compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Importar schema
import { busRoutes, busStops } from '../shared/schema';

// Configurar conexión a la base de datos
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema: { busRoutes, busStops } });

// Asegurarse de que el token de Mapbox está disponible
export const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
if (!MAPBOX_ACCESS_TOKEN) {
  throw new Error('MAPBOX_ACCESS_TOKEN environment variable is not set');
}

// Función para obtener las paradas de una ruta
export async function getRouteStops(routeId: number): Promise<Array<{ 
  id: number; 
  name: string; 
  coordinates: [number, number];
}>> {
  try {
    const stopsResult = await pool.query(
      'SELECT id, name, latitude, longitude, location FROM bus_stops WHERE route_id = $1 ORDER BY id',
      [routeId]
    );
    
    return stopsResult.rows.map(stop => {
      let coordinates: [number, number] = [0, 0];
      
      // Intentar obtener coordenadas del campo location
      if (stop.location) {
        try {
          const location = typeof stop.location === 'string' 
            ? JSON.parse(stop.location) 
            : stop.location;
          
          if (location.coordinates && Array.isArray(location.coordinates) && location.coordinates.length === 2) {
            coordinates = location.coordinates as [number, number];
          }
        } catch (e) {
          console.error('Error al parsear location:', e);
        }
      }
      
      // Si no se pudo obtener de location, usar latitude/longitude
      if (coordinates[0] === 0 && coordinates[1] === 0) {
        coordinates = [
          parseFloat(stop.longitude), 
          parseFloat(stop.latitude)
        ];
      }
      
      return {
        id: stop.id,
        name: stop.name,
        coordinates
      };
    });
  } catch (error) {
    console.error('Error al obtener paradas:', error);
    return [];
  }
}

// Función para dividir un array de coordenadas en chunks más pequeños
// Mapbox tiene un límite de 100 puntos por solicitud
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// Función para calcular la distancia entre dos puntos en metros
function haversineDistance(
  lat1: number, 
  lon1: number, 
  lat2: number, 
  lon2: number
): number {
  const R = 6371e3; // Radio de la Tierra en metros
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Función para calcular los radios adaptativos para cada punto de la ruta
// Puntos cercanos a intersecciones o curvas necesitan un radio más pequeño
function calculateAdaptiveRadiuses(coordinates: [number, number][]): number[] {
  if (coordinates.length <= 2) {
    return Array(coordinates.length).fill(25); // Radio predeterminado para rutas muy cortas
  }

  const radiuses: number[] = [];
  
  // Para el primer punto
  radiuses.push(25);
  
  // Para los puntos intermedios, calculamos basados en el cambio de dirección
  for (let i = 1; i < coordinates.length - 1; i++) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];
    const next = coordinates[i + 1];
    
    // Calcular los vectores de dirección
    const v1 = [curr[0] - prev[0], curr[1] - prev[1]];
    const v2 = [next[0] - curr[0], next[1] - curr[1]];
    
    // Normalizar vectores
    const m1 = Math.sqrt(v1[0] * v1[0] + v1[1] * v1[1]);
    const m2 = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1]);
    
    if (m1 === 0 || m2 === 0) {
      radiuses.push(25); // Valor predeterminado
      continue;
    }
    
    const u1 = [v1[0] / m1, v1[1] / m1];
    const u2 = [v2[0] / m2, v2[1] / m2];
    
    // Producto escalar para determinar el ángulo
    const dotProduct = u1[0] * u2[0] + u1[1] * u2[1];
    const angle = Math.acos(Math.min(Math.max(dotProduct, -1), 1));
    
    // Convertir a grados
    const angleDeg = (angle * 180) / Math.PI;
    
    // Determinar el radio basado en el ángulo
    // Menos radio en curvas pronunciadas, más radio en líneas rectas
    if (angleDeg > 45) {
      radiuses.push(5); // Curva pronunciada
    } else if (angleDeg > 20) {
      radiuses.push(15); // Curva moderada
    } else if (angleDeg > 10) {
      radiuses.push(25); // Curva ligera
    } else {
      radiuses.push(35); // Casi línea recta
    }
  }
  
  // Para el último punto
  radiuses.push(25);
  
  return radiuses;
}

// Función para ajustar coordenadas a carreteras usando Mapbox API con parámetros mejorados
export async function enhancedSnapToRoad(coordinates: [number, number][]): Promise<[number, number][]> {
  if (coordinates.length <= 1) {
    return coordinates;
  }

  // Si hay demasiados puntos, dividir en chunks con solapamiento para mejor continuidad
  if (coordinates.length > 50) {
    const CHUNK_SIZE = 50; // Tamaño de chunk reducido para evitar URLs demasiado largas
    const OVERLAP = 3;  // Puntos de solapamiento entre chunks
    const chunks: [number, number][][] = [];
    
    for (let i = 0; i < coordinates.length; i += (CHUNK_SIZE - OVERLAP)) {
      const end = Math.min(i + CHUNK_SIZE, coordinates.length);
      chunks.push(coordinates.slice(i, end));
    }
    
    console.log(`Dividiendo ${coordinates.length} puntos en ${chunks.length} chunks para procesar...`);

    const snappedChunks: [number, number][][] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`Procesando chunk ${i + 1}/${chunks.length} (${chunk.length} puntos)...`);
      
      try {
        const snappedChunk = await enhancedSnapToRoad(chunk);
        
        // Si no es el primer chunk, eliminamos los puntos de solapamiento con el chunk anterior
        if (i > 0 && snappedChunk.length > OVERLAP) {
          snappedChunks.push(snappedChunk.slice(OVERLAP));
        } else {
          snappedChunks.push(snappedChunk);
        }
      } catch (error) {
        console.error(`Error al procesar chunk ${i + 1}:`, error);
        snappedChunks.push(chunk);
      }
      
      // Pequeña pausa para no sobrecargar la API
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Unir todos los chunks
    return snappedChunks.flat();
  }

  // Usamos un radio uniforme para todos los puntos ya que el adaptativo está causando problemas
  const uniformRadius = 25;
  const radiuses = Array(coordinates.length).fill(uniformRadius);
  
  // Formato de coordenadas para la API de Mapbox: lon,lat
  const coordinatesStr = coordinates
    .map(coord => `${coord[0]},${coord[1]}`)
    .join(';');
  
  // Formato de radios
  const radiusesStr = radiuses.join(';');

  try {
    // Construir la URL con los parámetros adecuados pero simplificados para evitar errores
    const url = `https://api.mapbox.com/matching/v5/mapbox/driving/${coordinatesStr}?access_token=${MAPBOX_ACCESS_TOKEN}&geometries=geojson&overview=full&radiuses=${radiusesStr}`;

    // Hacer la solicitud a la API
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API respondió con código ${response.status}: ${errorText}`);
    }
    
    const data = await response.json() as any;

    // Verificar que la respuesta sea válida
    if (data.code !== 'Ok' || !data.matchings || data.matchings.length === 0) {
      console.error('Error en Mapbox API:', data);
      return coordinates; // Devolver coordenadas originales si hay error
    }

    // Si tenemos múltiples matchings (debido a gaps=split), combinarlos en orden
    if (data.matchings.length > 1) {
      const allCoordinates: [number, number][] = [];
      for (const matching of data.matchings) {
        allCoordinates.push(...matching.geometry.coordinates);
      }
      return allCoordinates;
    }

    // Extraer las coordenadas ajustadas
    return data.matchings[0].geometry.coordinates as [number, number][];
  } catch (error) {
    console.error('Error al hacer la solicitud a Mapbox:', error);
    return coordinates; // Devolver coordenadas originales si hay error
  }
}

// Función para integrar las paradas con la ruta de manera mejorada
export function enhancedIntegrateStopsWithRoute(
  routeCoords: [number, number][], 
  stopCoords: [number, number][]
): [number, number][] {
  if (!stopCoords.length) return routeCoords;
  
  // Crear una copia de las coordenadas de la ruta
  let enhancedCoords = [...routeCoords];
  
  // Lista para evitar duplicados o paradas muy cercanas
  const processedStops = new Set<string>();
  
  // Umbral de distancia en metros para considerar que una parada es cercana a la ruta
  const THRESHOLD_DISTANCE = 50; // 50 metros
  
  // Función para encontrar el segmento de ruta más cercano a una parada
  function findClosestSegment(stopCoord: [number, number]): [number, number, number] {
    let minDist = Infinity;
    let insertIdx = 0;
    let exactPoint: [number, number] | null = null;
    
    // Revisar cada segmento de la ruta
    for (let i = 0; i < enhancedCoords.length - 1; i++) {
      const start = enhancedCoords[i];
      const end = enhancedCoords[i + 1];
      
      // Distancia de la parada a los puntos de inicio y fin del segmento
      const distToStart = haversineDistance(stopCoord[1], stopCoord[0], start[1], start[0]);
      const distToEnd = haversineDistance(stopCoord[1], stopCoord[0], end[1], end[0]);
      
      // Si la parada está muy cerca de un punto existente, usamos ese punto
      if (distToStart < 5) { // 5 metros
        return [i, 0, 0]; // Usar el punto de inicio exacto
      }
      if (distToEnd < 5) { // 5 metros
        return [i + 1, 0, 0]; // Usar el punto de fin exacto
      }
      
      // Calcular el punto más cercano en el segmento y su distancia
      const segment = projectPointToSegment(stopCoord, start, end);
      const distToSegment = segment.distance;
      
      if (distToSegment < minDist) {
        minDist = distToSegment;
        insertIdx = i + 1; // Insertaríamos después del punto de inicio
        exactPoint = segment.point;
      }
    }
    
    // Si la distancia mínima es mayor que el umbral, retornar null
    if (minDist > THRESHOLD_DISTANCE) {
      return [-1, 0, 0]; // Indica que no hay un segmento lo suficientemente cercano
    }
    
    // Retornar el índice donde insertar y la proporción para interpolar
    return [insertIdx, minDist, exactPoint ? 1 : 0];
  }
  
  // Función para proyectar un punto en un segmento de línea y obtener el punto más cercano
  function projectPointToSegment(
    point: [number, number], 
    segStart: [number, number], 
    segEnd: [number, number]
  ): { point: [number, number]; distance: number } {
    // Convertir a coordenadas cartesianas aproximadas (usando factores de escala)
    const scale = Math.cos((point[1] * Math.PI) / 180);
    const x = point[0] * scale;
    const y = point[1];
    const x1 = segStart[0] * scale;
    const y1 = segStart[1];
    const x2 = segEnd[0] * scale;
    const y2 = segEnd[1];
    
    // Vector segmento
    const dx = x2 - x1;
    const dy = y2 - y1;
    
    // Longitud al cuadrado del segmento
    const lenSq = dx * dx + dy * dy;
    
    // Si el segmento es prácticamente un punto, retornar distancia al punto
    if (lenSq < 1e-10) {
      const dist = haversineDistance(point[1], point[0], segStart[1], segStart[0]);
      return { point: segStart, distance: dist };
    }
    
    // Proyección escalar del vector punto-segStart sobre el vector segmento
    const t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
    
    // Restringir t al rango [0, 1] para obtener el punto en el segmento
    const clampedT = Math.max(0, Math.min(1, t));
    
    // Punto proyectado
    const projX = x1 + clampedT * dx;
    const projY = y1 + clampedT * dy;
    
    // Convertir de vuelta a coordenadas geográficas
    const projLon = projX / scale;
    const projLat = projY;
    
    // Calcular distancia geodésica
    const dist = haversineDistance(point[1], point[0], projLat, projLon);
    
    return { 
      point: [projLon, projLat],
      distance: dist
    };
  }
  
  // Insertar cada parada cerca del segmento más cercano de la ruta
  for (const stopCoord of stopCoords) {
    // Verificar si ya procesamos una parada muy similar (para evitar duplicados)
    const stopKey = `${stopCoord[0].toFixed(5)},${stopCoord[1].toFixed(5)}`;
    if (processedStops.has(stopKey)) continue;
    
    // Encontrar el segmento más cercano
    const [insertIdx, distance, exactPoint] = findClosestSegment(stopCoord);
    
    if (insertIdx >= 0) {
      // Agregamos la parada a la ruta
      if (exactPoint && distance < 20) {
        // Si es un punto exacto en el segmento y está lo suficientemente cerca,
        // lo insertamos exactamente donde calculamos
        enhancedCoords.splice(insertIdx, 0, stopCoord);
      } else {
        // De lo contrario, insertamos la coordenada original de la parada
        enhancedCoords.splice(insertIdx, 0, stopCoord);
      }
      
      // Marcar como procesada
      processedStops.add(stopKey);
    }
  }
  
  return enhancedCoords;
}

// Función para ajustar una ruta a la carretera con el método mejorado
export async function enhancedSnapRouteToRoad(routeId: number): Promise<boolean> {
  try {
    // Obtener la ruta
    const [route] = await db.select().from(busRoutes).where(eq(busRoutes.id, routeId));
    
    if (!route) {
      console.error(`Ruta ${routeId} no encontrada.`);
      return false;
    }
    
    console.log(`Procesando ruta ${routeId}: ${route.name} (${route.shortName})`);
    
    // Extraer las coordenadas del geoJSON
    let routeCoordinates: [number, number][] = [];
    if (route.geoJSON) {
      try {
        const geoData = typeof route.geoJSON === 'string' 
          ? JSON.parse(route.geoJSON as string) 
          : route.geoJSON;
        
        if (geoData && geoData.type === "LineString" && geoData.coordinates && Array.isArray(geoData.coordinates)) {
          routeCoordinates = geoData.coordinates as [number, number][];
        } else if (geoData && geoData.type === "Feature" && geoData.geometry && geoData.geometry.type === "LineString" && 
                  geoData.geometry.coordinates && Array.isArray(geoData.geometry.coordinates)) {
          routeCoordinates = geoData.geometry.coordinates as [number, number][];
        } else if (geoData && geoData.coordinates && Array.isArray(geoData.coordinates)) {
          routeCoordinates = geoData.coordinates as [number, number][];
        }
      } catch (e) {
        console.error(`Error al parsear geoJSON para la ruta ${routeId}:`, e);
      }
    }
    
    if (routeCoordinates.length === 0) {
      console.error(`No se pudieron obtener coordenadas para la ruta ${routeId}`);
      return false;
    }
    
    console.log(`Ruta ${routeId} tiene ${routeCoordinates.length} puntos`);
    
    // Obtener las paradas de la ruta
    const stops = await getRouteStops(routeId);
    console.log(`Ruta ${routeId} tiene ${stops.length} paradas`);
    
    // Extraer coordenadas de las paradas
    const stopCoordinates = stops.map(stop => stop.coordinates);
    
    // Crear backup de la ruta original
    const backupDir = path.join(__dirname, '../data/backup');
    await fs.mkdir(backupDir, { recursive: true });
    
    await fs.writeFile(
      path.join(backupDir, `route_${routeId}_original.json`),
      JSON.stringify({
        id: routeId,
        name: route.name,
        coordinates: routeCoordinates
      }, null, 2)
    );
    
    // Integrar las paradas con las coordenadas de la ruta usando el método mejorado
    const enhancedCoordinates = enhancedIntegrateStopsWithRoute(routeCoordinates, stopCoordinates);
    console.log(`Ruta ${routeId} con paradas integradas tiene ${enhancedCoordinates.length} puntos`);
    
    // Ajustar a las carreteras con el método mejorado
    console.log(`Ajustando ruta ${routeId} a las carreteras...`);
    const snappedCoordinates = await enhancedSnapToRoad(enhancedCoordinates);
    
    // Crear nuevo objeto geoJSON
    const newGeoJSON = {
      type: "LineString",
      coordinates: snappedCoordinates
    };
    
    // Guardar la ruta ajustada
    await fs.writeFile(
      path.join(backupDir, `route_${routeId}_enhanced_snapped.json`),
      JSON.stringify(newGeoJSON, null, 2)
    );
    
    // Actualizar la ruta en la base de datos
    await db.update(busRoutes)
      .set({ 
        geoJSON: JSON.stringify(newGeoJSON)
      })
      .where(eq(busRoutes.id, routeId));
    
    console.log(`Ruta ${routeId} actualizada correctamente con método mejorado. ${routeCoordinates.length} puntos originales -> ${snappedCoordinates.length} puntos ajustados`);
    return true;
  } catch (error) {
    console.error(`Error al ajustar la ruta ${routeId}:`, error);
    return false;
  }
}

// Ejecución principal
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Por favor especifica un ID de ruta. Ejemplo: tsx scripts/enhanced-snap-to-road.ts 702');
    process.exit(1);
  }
  
  const routeId = parseInt(args[0], 10);
  if (isNaN(routeId)) {
    console.error('El ID de ruta debe ser un número');
    process.exit(1);
  }
  
  try {
    console.log(`Iniciando ajuste mejorado de ruta ${routeId} a las carreteras...`);
    
    // Crear directorio de datos si no existe
    const dataDir = path.join(__dirname, '../data');
    await fs.mkdir(dataDir, { recursive: true });
    
    const success = await enhancedSnapRouteToRoad(routeId);
    console.log(`Resultado: ${success ? 'Éxito' : 'Error'}`);
  } catch (error) {
    console.error('Error general:', error);
  } finally {
    await pool.end();
  }
}

// Ejecutar si es invocado directamente
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}