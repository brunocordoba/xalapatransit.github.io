import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { pool } from '../server/db';
import { busStops, busRoutes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const db = drizzle(pool);

// Rutas de archivos
const STOPS_JSON_FILE = path.join(__dirname, '..', 'attached_assets', '2017-03-04_04-27_stops.json');

async function importStopsFromJson() {
  try {
    console.log('Importando paradas desde JSON...');
    
    // Leer el archivo JSON
    const stopsJson = JSON.parse(fs.readFileSync(STOPS_JSON_FILE, 'utf-8'));
    
    // Verificar formato de GeoJSON
    if (stopsJson.type !== 'FeatureCollection' || !Array.isArray(stopsJson.features)) {
      console.error('El archivo no tiene formato de GeoJSON válido');
      return;
    }
    
    const features = stopsJson.features;
    console.log(`Se encontraron ${features.length} paradas en el archivo JSON`);
    
    // Para cada ruta en la base de datos, buscar las paradas correspondientes
    const routes = await db.select().from(busRoutes);
    console.log(`Se encontraron ${routes.length} rutas en la base de datos`);
    
    let totalImported = 0;
    
    // Importar paradas para todas las rutas
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
  } catch (error) {
    console.error('Error en importStopsFromJson:', error);
  }
}

// Ejecutar la función
importStopsFromJson()
  .then(() => {
    console.log('Proceso completado');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en el proceso:', error);
    process.exit(1);
  });