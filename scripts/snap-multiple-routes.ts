import { pool } from "../server/db";
import fetch from "node-fetch";
import * as dotenv from "dotenv";

dotenv.config();

// Asegurarse que tenemos el token de Mapbox
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
if (!MAPBOX_ACCESS_TOKEN) {
  console.error("Error: MAPBOX_ACCESS_TOKEN no está definido en variables de entorno");
  process.exit(1);
}

// Función para dividir un array en segmentos más pequeños
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// Función para simplificar coordenadas usando el algoritmo de Douglas-Peucker
function simplifyCoordinates(
  coordinates: [number, number][],
  tolerance: number
): [number, number][] {
  if (coordinates.length <= 2) {
    return coordinates;
  }
  
  // Calcular la distancia de un punto a una línea
  function perpendicularDistance(point: [number, number], lineStart: [number, number], lineEnd: [number, number]): number {
    const [x, y] = point;
    const [x1, y1] = lineStart;
    const [x2, y2] = lineEnd;
    
    // Si los puntos de la línea son iguales, devolver la distancia al punto
    if (x1 === x2 && y1 === y2) {
      return Math.sqrt(Math.pow(x - x1, 2) + Math.pow(y - y1, 2));
    }
    
    // Calcular la distancia perpendicular
    const numerator = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1);
    const denominator = Math.sqrt(Math.pow(y2 - y1, 2) + Math.pow(x2 - x1, 2));
    
    return numerator / denominator;
  }
  
  // Implementación recursiva de Douglas-Peucker
  function douglasPeucker(points: [number, number][], start: number, end: number, epsilon: number): number[] {
    // Encontrar el punto con la mayor distancia perpendicular
    let dmax = 0;
    let index = 0;
    
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[start], points[end]);
      if (d > dmax) {
        index = i;
        dmax = d;
      }
    }
    
    // Si la distancia máxima es mayor que epsilon, dividir y simplificar recursivamente
    const result: number[] = [];
    if (dmax > epsilon) {
      const recResults1 = douglasPeucker(points, start, index, epsilon);
      const recResults2 = douglasPeucker(points, index, end, epsilon);
      
      // Combinar los resultados sin duplicar el punto de división
      result.push(...recResults1.slice(0, -1));
      result.push(...recResults2);
    } else {
      // La línea no necesita más puntos
      result.push(start);
      result.push(end);
    }
    
    return result;
  }
  
  // Ejecutar el algoritmo
  const indices = douglasPeucker(coordinates, 0, coordinates.length - 1, tolerance);
  
  // Ordenar los índices y eliminar duplicados
  const uniqueIndices = [...new Set(indices)].sort((a, b) => a - b);
  
  // Construir el resultado con los puntos seleccionados
  return uniqueIndices.map(index => coordinates[index]);
}

// Hacer snap-to-road con las coordenadas utilizando la API de Mapbox
async function snapToRoad(coordinates: [number, number][]): Promise<[number, number][]> {
  if (coordinates.length < 2) {
    console.log("No hay suficientes coordenadas para hacer snap-to-road");
    return coordinates;
  }

  // Convertir coordenadas al formato que espera Mapbox (lon,lat;lon,lat;...)
  const coordinatesString = coordinates
    .map((coord) => `${coord[1]},${coord[0]}`) // Mapbox usa lon,lat
    .join(";");

  // Configurar parámetros para la petición
  const url = `https://api.mapbox.com/matching/v5/mapbox/driving/${coordinatesString}?access_token=${MAPBOX_ACCESS_TOKEN}&geometries=geojson&overview=full&radiuses=${coordinates.map(() => "50").join(";")}`;

  try {
    console.log(`Enviando petición a Mapbox Map Matching API con ${coordinates.length} puntos`);
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error(`Error en la respuesta de Mapbox: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error(`Detalle del error: ${errorText}`);
      return coordinates; // En caso de error, devolver las coordenadas originales
    }
    
    const data = await response.json() as any;
    
    if (data.code !== "Ok" || !data.matchings || data.matchings.length === 0) {
      console.error("No se obtuvieron resultados de matching:", data);
      return coordinates;
    }

    // Obtener las coordenadas ajustadas a la carretera
    const snappedCoordinates = data.matchings[0].geometry.coordinates.map(
      (coord: [number, number]): [number, number] => [coord[1], coord[0]] // Convertir de [lon,lat] a [lat,lon]
    );

    console.log(`Se obtuvieron ${snappedCoordinates.length} coordenadas ajustadas`);
    return snappedCoordinates;
  } catch (error) {
    console.error("Error al hacer snap-to-road:", error);
    return coordinates; // En caso de error, devolver las coordenadas originales
  }
}

// Procesamiento por lotes para evitar límites de la API
async function processCoordinatesInBatches(
  coordinates: [number, number][],
  batchSize: number = 100
): Promise<[number, number][]> {
  // Dividir coordenadas en lotes para evitar superar límites de la API
  const batches = chunkArray(coordinates, batchSize);
  let allSnappedCoords: [number, number][] = [];
  
  console.log(`Procesando ${coordinates.length} coordenadas en ${batches.length} lotes`);
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`Procesando lote ${i + 1}/${batches.length} con ${batch.length} coordenadas`);
    
    const snappedBatch = await snapToRoad(batch);
    allSnappedCoords = allSnappedCoords.concat(snappedBatch);
    
    // Esperar un poco entre peticiones para no sobrecargar la API
    if (i < batches.length - 1) {
      console.log("Esperando 1 segundo antes del siguiente lote...");
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return allSnappedCoords;
}

// Procesar una ruta individual
async function processRoute(routeId: number): Promise<boolean> {
  try {
    // Buscar la ruta en la base de datos
    const routeQuery = await pool.query(
      "SELECT id, name, geo_json FROM bus_routes WHERE id = $1",
      [routeId]
    );
    
    if (routeQuery.rows.length === 0) {
      console.error(`No se encontró la ruta con ID ${routeId} en la base de datos`);
      return false;
    }
    
    const route = routeQuery.rows[0];
    console.log(`Procesando ruta: ${route.name} (ID: ${route.id})`);
    
    // Obtener las paradas de la ruta
    const stopsQuery = await pool.query(
      "SELECT id, name, latitude, longitude FROM bus_stops WHERE route_id = $1 ORDER BY id",
      [route.id]
    );
    
    if (stopsQuery.rows.length === 0) {
      console.log("No se encontraron paradas para esta ruta. Usando GeoJSON directamente.");
    } else {
      console.log(`Se encontraron ${stopsQuery.rows.length} paradas para la ruta ${route.id}`);
    }
    
    // Obtener las coordenadas del GeoJSON de la ruta
    let coordinates: [number, number][] = [];
    
    if (route.geo_json) {
      try {
        const geoJson = typeof route.geo_json === 'string' 
          ? JSON.parse(route.geo_json) 
          : route.geo_json;
        
        if (geoJson.type === "LineString" && Array.isArray(geoJson.coordinates)) {
          coordinates = geoJson.coordinates.map((coord: number[]) => 
            [Number(coord[1]), Number(coord[0])] as [number, number]
          );
        } else if (geoJson.type === "Feature" && 
                  geoJson.geometry && 
                  geoJson.geometry.type === "LineString" && 
                  Array.isArray(geoJson.geometry.coordinates)) {
          coordinates = geoJson.geometry.coordinates.map((coord: number[]) => 
            [Number(coord[1]), Number(coord[0])] as [number, number]
          );
        }
      } catch (error) {
        console.error("Error al parsear el GeoJSON:", error);
        return false;
      }
    }
    
    if (coordinates.length === 0) {
      console.error("No se pudieron obtener coordenadas válidas del GeoJSON");
      return false;
    }
    
    console.log(`Se obtuvieron ${coordinates.length} puntos del GeoJSON original`);
    
    // Incorporar las paradas como puntos de referencia en las coordenadas
    if (stopsQuery.rows.length > 0) {
      // Extraer coordenadas de las paradas
      const stopCoordinates = stopsQuery.rows.map(stop => 
        [Number(stop.latitude), Number(stop.longitude)] as [number, number]
      );
      
      // Podríamos mezclar las coordenadas de las paradas con la ruta original,
      // pero para mantener la integridad de la ruta, vamos a usarlas como guía
      // en el proceso de snap-to-road
      console.log(`Incorporando ${stopCoordinates.length} paradas como puntos guía`);
      
      // Combinamos las coordenadas en un solo arreglo, manteniendo el orden
      const combinedCoordinates = [...coordinates];
      
      // Para cada parada, encontramos el punto más cercano en la ruta y la insertamos ahí
      stopCoordinates.forEach(stopCoord => {
        // Calcular distancia mínima a la ruta existente
        let minDistance = Number.MAX_VALUE;
        let insertIndex = 0;
        
        for (let i = 0; i < combinedCoordinates.length; i++) {
          const routeCoord = combinedCoordinates[i];
          const distance = Math.sqrt(
            Math.pow(stopCoord[0] - routeCoord[0], 2) + 
            Math.pow(stopCoord[1] - routeCoord[1], 2)
          );
          
          if (distance < minDistance) {
            minDistance = distance;
            insertIndex = i;
          }
        }
        
        // Si está muy lejos, la insertamos después del punto más cercano
        if (minDistance > 0.0005) { // aprox. 50 metros
          combinedCoordinates.splice(insertIndex + 1, 0, stopCoord);
        }
        // Si está muy cerca, reemplazamos el punto con la parada para mejorar precisión
        else {
          combinedCoordinates[insertIndex] = stopCoord;
        }
      });
      
      console.log(`Ruta con paradas incorporadas: ${combinedCoordinates.length} puntos`);
      coordinates = combinedCoordinates;
    }
    
    // Reducir la cantidad de puntos antes de procesar
    console.log("Reduciendo la cantidad de puntos para optimizar el procesamiento...");
    const simplifiedCoordinates = simplifyCoordinates(coordinates, 0.0001); // ~10m de tolerancia
    console.log(`Reducidos de ${coordinates.length} a ${simplifiedCoordinates.length} puntos`);
    
    // Procesar las coordenadas con la API de Mapbox para ajustarlas a las calles
    console.log("Iniciando proceso de snap-to-road con Mapbox...");
    const snappedCoordinates = await processCoordinatesInBatches(simplifiedCoordinates, 90);
    
    if (snappedCoordinates.length === 0) {
      console.error("No se obtuvieron coordenadas después del snap-to-road");
      return false;
    }
    
    console.log(`Se obtuvieron ${snappedCoordinates.length} puntos después del snap-to-road`);
    
    // Crear GeoJSON con las nuevas coordenadas
    const newGeoJson = {
      type: "LineString",
      coordinates: snappedCoordinates.map(coord => [coord[1], coord[0]]) // Convertir a [lon, lat]
    };
    
    // Actualizar la base de datos
    await pool.query(
      "UPDATE bus_routes SET geo_json = $1 WHERE id = $2",
      [JSON.stringify(newGeoJson), route.id]
    );
    
    console.log(`Ruta ${route.id} actualizada correctamente con ${snappedCoordinates.length} puntos`);
    return true;
    
  } catch (error) {
    console.error(`Error al procesar la ruta ${routeId}:`, error);
    return false;
  }
}

// Función principal para procesar múltiples rutas
async function processMultipleRoutes(startId: number, endId: number) {
  try {
    // Obtener las rutas en el rango especificado
    const routeIdsQuery = await pool.query(
      "SELECT id FROM bus_routes WHERE id >= $1 AND id <= $2 ORDER BY id",
      [startId, endId]
    );
    
    if (routeIdsQuery.rows.length === 0) {
      console.log(`No se encontraron rutas en el rango ${startId}-${endId}`);
      return;
    }
    
    const routeIds = routeIdsQuery.rows.map(row => row.id);
    console.log(`Se procesarán ${routeIds.length} rutas (IDs: ${routeIds.join(', ')})`);
    
    // Procesar cada ruta secuencialmente
    for (let i = 0; i < routeIds.length; i++) {
      const routeId = routeIds[i];
      console.log(`\n===== Procesando ruta ${i + 1}/${routeIds.length}: ID ${routeId} =====`);
      
      const success = await processRoute(routeId);
      
      if (success) {
        console.log(`Ruta ${routeId} procesada exitosamente`);
      } else {
        console.error(`Error al procesar la ruta ${routeId}`);
      }
      
      // Esperar entre rutas para no sobrecargar la API
      if (i < routeIds.length - 1) {
        console.log("Esperando 3 segundos antes de la siguiente ruta...");
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    console.log("\nProcesamiento de rutas completado");
    
  } catch (error) {
    console.error("Error al procesar las rutas:", error);
  } finally {
    // Cerrar la conexión al pool
    await pool.end();
  }
}

// Obtener IDs de ruta desde argumentos de línea de comandos
const args = process.argv.slice(2);
let startId = 568; // Por defecto, comenzar con la ruta 1 (ID 568)
let endId = 570;   // Y terminar con algunas rutas más

if (args.length >= 1) {
  startId = parseInt(args[0], 10);
}

if (args.length >= 2) {
  endId = parseInt(args[1], 10);
}

// Iniciar el procesamiento
processMultipleRoutes(startId, endId).then(() => {
  console.log("Procesamiento completado");
}).catch(error => {
  console.error("Error en el proceso principal:", error);
  process.exit(1);
});