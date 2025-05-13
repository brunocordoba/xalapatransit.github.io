import { pool } from '../server/db';
import { busRoutes, busStops, BusRoute, BusStop } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-serverless';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// Cargar variables de entorno (requerido para acceder a MAPBOX_ACCESS_TOKEN)
require('dotenv').config();

const db = drizzle(pool, { schema: { busRoutes, busStops } });

// Asegurarse de que el token de Mapbox está disponible
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
if (!MAPBOX_ACCESS_TOKEN) {
  console.error('ERROR: MAPBOX_ACCESS_TOKEN no está definido en las variables de entorno.');
  process.exit(1);
}

// Función para dividir un array de coordenadas en chunks de tamaño máximo
// Mapbox tiene un límite de 100 puntos por solicitud
function chunkCoordinates(coordinates: [number, number][], maxChunkSize = 90): [number, number][][] {
  const chunks: [number, number][][] = [];
  
  for (let i = 0; i < coordinates.length; i += maxChunkSize) {
    // Si el chunk no es el primero, añadir el último punto del chunk anterior como primero del nuevo
    const chunkStart = i === 0 ? 0 : i - 1;
    chunks.push(coordinates.slice(chunkStart, i + maxChunkSize));
  }
  
  return chunks;
}

// Función para ajustar coordenadas a la carretera usando Mapbox API
async function snapToRoad(coordinates: [number, number][]): Promise<[number, number][]> {
  if (coordinates.length <= 1) {
    return coordinates;
  }
  
  // Dividir en chunks si hay demasiados puntos
  if (coordinates.length > 90) {
    const chunks = chunkCoordinates(coordinates);
    let result: [number, number][] = [];
    
    for (const chunk of chunks) {
      const snappedChunk = await snapToRoad(chunk);
      
      // Si no es el primer chunk, eliminar el primer punto (duplicado)
      if (result.length > 0 && snappedChunk.length > 0) {
        result = result.concat(snappedChunk.slice(1));
      } else {
        result = result.concat(snappedChunk);
      }
    }
    
    return result;
  }
  
  // Formato de coordenadas para la API de Mapbox: lon,lat
  const coordinatesString = coordinates.map(coord => `${coord[0]},${coord[1]}`).join(';');
  
  try {
    const url = `https://api.mapbox.com/matching/v5/mapbox/driving/${coordinatesString}?access_token=${MAPBOX_ACCESS_TOKEN}&geometries=geojson&overview=full&radiuses=${Array(coordinates.length).fill(25).join(';')}`;
    
    const response = await fetch(url);
    const data = await response.json() as any;
    
    if (data.code !== 'Ok' || !data.matchings || data.matchings.length === 0) {
      console.error('Error en Mapbox API:', data);
      return coordinates; // Devolver coordenadas originales si hay error
    }
    
    // Extraer las coordenadas ajustadas a la carretera
    const snappedCoordinates = data.matchings[0].geometry.coordinates as [number, number][];
    return snappedCoordinates;
  } catch (error) {
    console.error('Error al hacer la solicitud a Mapbox:', error);
    return coordinates; // Devolver coordenadas originales si hay error
  }
}

// Función para obtener las coordenadas de las paradas de una ruta
async function getRouteStopsCoordinates(routeId: number): Promise<[number, number][]> {
  const stops = await db.query.busStops.findMany({
    where: eq(busStops.routeId, routeId),
    orderBy: busStops.order
  });
  
  return stops.map(stop => JSON.parse(stop.location).coordinates as [number, number]);
}

// Función para encontrar el índice del punto más cercano a una coordenada dada
function findClosestPointIndex(point: [number, number], coords: [number, number][]): number {
  let minDist = Infinity;
  let closestIdx = 0;
  
  for (let i = 0; i < coords.length; i++) {
    const dist = Math.sqrt(
      Math.pow(coords[i][0] - point[0], 2) + 
      Math.pow(coords[i][1] - point[1], 2)
    );
    
    if (dist < minDist) {
      minDist = dist;
      closestIdx = i;
    }
  }
  
  return closestIdx;
}

// Función para intercalar paradas en la ruta
function integrateStopsWithRoute(
  routeCoordinates: [number, number][], 
  stopCoordinates: [number, number][]
): [number, number][] {
  if (stopCoordinates.length === 0) {
    return routeCoordinates;
  }
  
  const result: [number, number][] = [...routeCoordinates];
  
  // Para cada parada, insertarla cerca del punto más cercano en la ruta
  for (const stop of stopCoordinates) {
    const closestIdx = findClosestPointIndex(stop, result);
    
    // Insertar la parada en la posición correcta
    // Si está más cerca del inicio, la insertamos antes
    // Si está más cerca del final, la insertamos después
    if (closestIdx === 0) {
      result.splice(1, 0, stop);
    } else if (closestIdx === result.length - 1) {
      result.splice(closestIdx, 0, stop);
    } else {
      result.splice(closestIdx + 1, 0, stop);
    }
  }
  
  return result;
}

// Función principal para ajustar una ruta a la carretera
async function snapRouteToRoad(routeId: number): Promise<boolean> {
  try {
    // Obtener la ruta
    const [route] = await db.select().from(busRoutes).where(eq(busRoutes.id, routeId));
    
    if (!route) {
      console.error(`Ruta ${routeId} no encontrada.`);
      return false;
    }
    
    // Obtener las coordenadas de la ruta
    let coordinates: [number, number][] = [];
    
    if (route.geometry) {
      coordinates = JSON.parse(route.geometry).coordinates;
    } else {
      console.error(`Ruta ${routeId} no tiene geometría.`);
      return false;
    }
    
    // Obtener las coordenadas de las paradas para usarlas como puntos de anclaje
    const stopCoordinates = await getRouteStopsCoordinates(routeId);
    
    // Integrar las paradas con la ruta para mayor precisión
    const enhancedCoordinates = integrateStopsWithRoute(coordinates, stopCoordinates);
    
    console.log(`Ajustando ruta ${routeId} (${route.name}) - ${enhancedCoordinates.length} puntos (${coordinates.length} originales + ${stopCoordinates.length} paradas)`);
    
    // Ajustar a la carretera
    const snappedCoordinates = await snapToRoad(enhancedCoordinates);
    
    // Guardar resultado
    if (snappedCoordinates.length > 0) {
      const newGeometry = {
        type: "LineString",
        coordinates: snappedCoordinates
      };
      
      // Actualizar en la base de datos
      await db.update(busRoutes)
        .set({ 
          geometry: JSON.stringify(newGeometry),
          updatedAt: new Date()
        })
        .where(eq(busRoutes.id, routeId));
      
      console.log(`Ruta ${routeId} actualizada con éxito. ${snappedCoordinates.length} puntos.`);
      return true;
    } else {
      console.error(`No se pudieron ajustar las coordenadas para la ruta ${routeId}.`);
      return false;
    }
  } catch (error) {
    console.error(`Error al ajustar la ruta ${routeId}:`, error);
    return false;
  }
}

// Función para procesar todas las rutas
async function snapAllRoutesToRoad() {
  try {
    // Obtener todas las rutas
    const routes = await db.select().from(busRoutes);
    console.log(`Procesando ${routes.length} rutas...`);
    
    // Crear directorio para backup si no existe
    const backupDir = path.join(__dirname, '../data/backup/routes');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Hacer backup de las rutas actuales
    fs.writeFileSync(
      path.join(backupDir, `routes_backup_${new Date().toISOString().replace(/:/g, '-')}.json`),
      JSON.stringify(routes, null, 2)
    );
    
    let successCount = 0;
    let errorCount = 0;
    
    // Procesar cada ruta
    for (const route of routes) {
      try {
        const success = await snapRouteToRoad(route.id);
        if (success) {
          successCount++;
        } else {
          errorCount++;
        }
        
        // Pequeña pausa para no sobrecargar la API
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error procesando ruta ${route.id}:`, error);
        errorCount++;
      }
    }
    
    console.log(`Proceso completado. Rutas ajustadas con éxito: ${successCount}. Errores: ${errorCount}`);
  } catch (error) {
    console.error('Error al procesar las rutas:', error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// Función para ajustar una sola ruta por ID
async function snapSingleRouteToRoad(routeId: number) {
  try {
    const success = await snapRouteToRoad(routeId);
    console.log(`Proceso completado para ruta ${routeId}: ${success ? 'Éxito' : 'Error'}`);
  } catch (error) {
    console.error(`Error al procesar la ruta ${routeId}:`, error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// Ejecución principal
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length > 0 && args[0] === '--route') {
    // Si se especifica una ruta específica
    const routeId = parseInt(args[1], 10);
    if (isNaN(routeId)) {
      console.error('Error: El ID de ruta debe ser un número');
      process.exit(1);
    }
    await snapSingleRouteToRoad(routeId);
  } else if (args.length > 0 && args[0] === '--test') {
    // Modo de prueba con la primera ruta
    const routes = await db.select().from(busRoutes).limit(1);
    if (routes.length > 0) {
      await snapSingleRouteToRoad(routes[0].id);
    } else {
      console.error('No hay rutas para probar');
      process.exit(1);
    }
  } else {
    // Procesar todas las rutas
    await snapAllRoutesToRoad();
  }
}

// Iniciar el proceso
main().catch(error => {
  console.error('Error en la ejecución principal:', error);
  process.exit(1);
});