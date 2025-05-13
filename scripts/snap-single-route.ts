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

// Función para ajustar coordenadas a carreteras usando Mapbox API
export async function snapToRoad(coordinates: [number, number][]): Promise<[number, number][]> {
  if (coordinates.length <= 1) {
    return coordinates;
  }

  // Si hay demasiados puntos, dividir en chunks
  if (coordinates.length > 90) {
    const chunks = chunkArray(coordinates, 90);
    const snappedChunks: [number, number][][] = [];

    console.log(`Dividiendo ${coordinates.length} puntos en ${chunks.length} chunks para procesar...`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`Procesando chunk ${i + 1}/${chunks.length} (${chunk.length} puntos)...`);
      
      try {
        const snappedChunk = await snapToRoad(chunk as [number, number][]);
        snappedChunks.push(snappedChunk);
      } catch (error) {
        console.error(`Error al procesar chunk ${i + 1}:`, error);
        snappedChunks.push(chunk as [number, number][]);
      }
      
      // Pequeña pausa para no sobrecargar la API
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Unir todos los chunks
    return snappedChunks.flat();
  }

  // Formato de coordenadas para la API de Mapbox: lon,lat
  const coordinatesStr = coordinates
    .map(coord => `${coord[0]},${coord[1]}`)
    .join(';');

  try {
    // Construir la URL con los parámetros adecuados
    const url = `https://api.mapbox.com/matching/v5/mapbox/driving/${coordinatesStr}?access_token=${MAPBOX_ACCESS_TOKEN}&geometries=geojson&overview=full&radiuses=${Array(coordinates.length).fill(25).join(';')}`;

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

    // Extraer las coordenadas ajustadas
    return data.matchings[0].geometry.coordinates as [number, number][];
  } catch (error) {
    console.error('Error al hacer la solicitud a Mapbox:', error);
    return coordinates; // Devolver coordenadas originales si hay error
  }
}

// Función para integrar las paradas con la ruta
export function integrateStopsWithRoute(routeCoords: [number, number][], stopCoords: [number, number][]): [number, number][] {
  if (!stopCoords.length) return routeCoords;
  
  // Crear una copia de las coordenadas de la ruta
  const enhancedCoords = [...routeCoords];
  
  // Función para encontrar el punto más cercano en la ruta para una parada
  function findClosestPointIndex(stopCoord: [number, number]): number {
    let minDist = Infinity;
    let closestIdx = 0;
    
    for (let i = 0; i < enhancedCoords.length; i++) {
      const dist = Math.pow(enhancedCoords[i][0] - stopCoord[0], 2) + 
                   Math.pow(enhancedCoords[i][1] - stopCoord[1], 2);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }
    
    return closestIdx;
  }
  
  // Insertar cada parada cerca del punto más cercano en la ruta
  for (const stopCoord of stopCoords) {
    const closestIdx = findClosestPointIndex(stopCoord);
    
    // Insertamos la parada justo después del punto más cercano
    if (closestIdx < enhancedCoords.length - 1) {
      enhancedCoords.splice(closestIdx + 1, 0, stopCoord);
    } else {
      enhancedCoords.push(stopCoord);
    }
  }
  
  return enhancedCoords;
}

// Función para ajustar una ruta a la carretera
export async function snapRouteToRoad(routeId: number): Promise<boolean> {
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
        
        if (geoData && geoData.coordinates && Array.isArray(geoData.coordinates)) {
          routeCoordinates = geoData.coordinates as [number, number][];
        } else if (geoData && geoData.geometry && geoData.geometry.coordinates && Array.isArray(geoData.geometry.coordinates)) {
          // Alternativa si la estructura es diferente
          routeCoordinates = geoData.geometry.coordinates as [number, number][];
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
    
    // Integrar las paradas con las coordenadas de la ruta
    const enhancedCoordinates = integrateStopsWithRoute(routeCoordinates, stopCoordinates);
    console.log(`Ruta ${routeId} con paradas integradas tiene ${enhancedCoordinates.length} puntos`);
    
    // Ajustar a las carreteras
    console.log(`Ajustando ruta ${routeId} a las carreteras...`);
    const snappedCoordinates = await snapToRoad(enhancedCoordinates);
    
    // Crear nuevo objeto geoJSON
    const newGeoJSON = {
      type: "LineString",
      coordinates: snappedCoordinates
    };
    
    // Guardar la ruta ajustada
    await fs.writeFile(
      path.join(backupDir, `route_${routeId}_snapped.json`),
      JSON.stringify(newGeoJSON, null, 2)
    );
    
    // Actualizar la ruta en la base de datos
    await db.update(busRoutes)
      .set({ 
        geoJSON: JSON.stringify(newGeoJSON)
      })
      .where(eq(busRoutes.id, routeId));
    
    console.log(`Ruta ${routeId} actualizada correctamente. ${routeCoordinates.length} puntos originales -> ${snappedCoordinates.length} puntos ajustados`);
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
    console.error('Por favor especifica un ID de ruta. Ejemplo: tsx scripts/snap-single-route.ts 702');
    process.exit(1);
  }
  
  const routeId = parseInt(args[0], 10);
  if (isNaN(routeId)) {
    console.error('El ID de ruta debe ser un número');
    process.exit(1);
  }
  
  try {
    console.log(`Iniciando ajuste de ruta ${routeId} a las carreteras...`);
    
    // Crear directorio de datos si no existe
    const dataDir = path.join(__dirname, '../data');
    await fs.mkdir(dataDir, { recursive: true });
    
    const success = await snapRouteToRoad(routeId);
    console.log(`Resultado: ${success ? 'Éxito' : 'Error'}`);
  } catch (error) {
    console.error('Error general:', error);
  } finally {
    await pool.end();
  }
}

main();