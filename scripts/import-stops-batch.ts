import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { pool } from '../server/db';
import { busStops, busRoutes } from '../shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const db = drizzle(pool);

// Parámetros para procesar por lotes
const START_ROUTE_ID = parseInt(process.argv[2] || '454', 10);
const END_ROUTE_ID = parseInt(process.argv[3] || '470', 10);

async function importStopsBatch() {
  try {
    console.log(`Importando paradas para rutas de ID ${START_ROUTE_ID} a ${END_ROUTE_ID}...`);
    
    // Obtener rutas en el rango especificado
    const routes = await db.select()
      .from(busRoutes)
      .where(
        and(
          gte(busRoutes.id, START_ROUTE_ID),
          lte(busRoutes.id, END_ROUTE_ID)
        )
      )
      .orderBy(busRoutes.id);
    
    console.log(`Se encontraron ${routes.length} rutas en el rango especificado`);
    
    let totalImported = 0;
    
    // Procesar cada ruta
    for (const route of routes) {
      const routeId = route.id;
      console.log(`Procesando ruta ${routeId}: ${route.name}`);
      
      // Obtener las paradas existentes para esta ruta
      const existingStops = await db.select().from(busStops).where(eq(busStops.routeId, routeId));
      console.log(`La ruta ${routeId} ya tiene ${existingStops.length} paradas en la base de datos`);
      
      if (existingStops.length > 0) {
        console.log(`Saltando ruta ${routeId} pues ya tiene paradas`);
        continue;
      }

      // Generar paradas automáticas a lo largo de la ruta
      let stopsImported = 0;
      
      try {
        // Obtener el GeoJSON de la ruta
        const geoJson = route.geoJSON;
        if (!geoJson) {
          console.warn(`La ruta ${routeId} no tiene GeoJSON`);
          continue;
        }
        
        // Parsear GeoJSON si es necesario
        const routeGeoJson = typeof geoJson === 'string' ? JSON.parse(geoJson) : geoJson;
        
        // Extraer coordenadas
        let coordinates: [number, number][] = [];
        
        if (routeGeoJson.type === 'FeatureCollection' && routeGeoJson.features && routeGeoJson.features.length > 0) {
          coordinates = routeGeoJson.features[0].geometry.coordinates;
        } else if (routeGeoJson.type === 'Feature') {
          coordinates = routeGeoJson.geometry.coordinates;
        } else if (routeGeoJson.coordinates) {
          coordinates = routeGeoJson.coordinates;
        } else {
          console.warn(`No se pudieron extraer coordenadas de la ruta ${routeId}`);
          continue;
        }
        
        console.log(`La ruta ${routeId} tiene ${coordinates.length} puntos`);
        
        // Generar paradas cada cierta cantidad de puntos
        const numStops = Math.min(10, Math.max(3, Math.floor(coordinates.length / 10)));
        const interval = Math.floor(coordinates.length / numStops);
        
        // Crear paradas a lo largo de la ruta
        for (let i = 0; i < numStops; i++) {
          const index = i * interval;
          
          if (index < coordinates.length) {
            const coord = coordinates[index];
            const longitude = coord[0].toString();
            const latitude = coord[1].toString();
            const isTerminal = i === 0 || i === numStops - 1;
            const terminalType = isTerminal ? (i === 0 ? 'inicio' : 'fin') : '';
            const stopName = `Parada ${routeId}-${i + 1}`;
            
            // Insertar parada en la base de datos
            await db.insert(busStops).values({
              routeId,
              name: stopName,
              latitude,
              longitude,
              isTerminal,
              terminalType
            });
            
            stopsImported++;
            console.log(`Parada ${stopName} importada en [${latitude}, ${longitude}]`);
          }
        }
        
        console.log(`Se importaron ${stopsImported} paradas para la ruta ${routeId}`);
        totalImported += stopsImported;
      } catch (error) {
        console.error(`Error al procesar la ruta ${routeId}:`, error);
      }
    }
    
    console.log(`Importación completada. Se importaron ${totalImported} paradas en total.`);
    return totalImported;
  } catch (error) {
    console.error('Error en importStopsBatch:', error);
    return 0;
  }
}

// Ejecutar la función
importStopsBatch()
  .then((count) => {
    console.log(`Proceso completado. Se importaron ${count} paradas.`);
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en el proceso:', error);
    process.exit(1);
  });