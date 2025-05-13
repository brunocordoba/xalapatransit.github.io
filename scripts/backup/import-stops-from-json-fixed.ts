import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { pool } from '../server/db';
import { busStops, busRoutes } from '../shared/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const db = drizzle(pool);

// ID de la ruta en la base de datos a la que asignaremos las paradas
const TARGET_ROUTE_ID = 345; // ID de "1. Ruta 1" en nuestra DB

async function importStopsFromJson() {
  try {
    // Ruta al archivo JSON de paradas
    const stopsJsonPath = path.join(__dirname, '..', 'attached_assets', '2017-03-04_04-27_stops.json');
    
    console.log(`Importando paradas para la ruta ${TARGET_ROUTE_ID} desde ${stopsJsonPath}`);
    
    // Verificar si el archivo existe
    if (!fs.existsSync(stopsJsonPath)) {
      console.error(`Archivo no encontrado: ${stopsJsonPath}`);
      return { totalImported: 0 };
    }
    
    // Leer el archivo JSON
    const stopsJson = fs.readFileSync(stopsJsonPath, 'utf-8');
    const stopsData = JSON.parse(stopsJson);
    
    // Verificar que tiene el formato correcto (GeoJSON FeatureCollection)
    if (!stopsData.type || stopsData.type !== 'FeatureCollection' || !Array.isArray(stopsData.features)) {
      console.error('El archivo de paradas no tiene el formato GeoJSON FeatureCollection esperado');
      return { totalImported: 0 };
    }
    
    // Verificar si la ruta existe
    const route = await db.select().from(busRoutes).where(eq(busRoutes.id, TARGET_ROUTE_ID)).limit(1);
    if (route.length === 0) {
      console.error(`La ruta con ID ${TARGET_ROUTE_ID} no existe en la base de datos`);
      return { totalImported: 0 };
    }
    
    // Verificar si ya hay paradas para esta ruta
    const existingStops = await db.select().from(busStops).where(eq(busStops.routeId, TARGET_ROUTE_ID));
    
    // Si ya hay paradas, las eliminaremos y las reemplazaremos
    if (existingStops.length > 0) {
      console.log(`La ruta ${TARGET_ROUTE_ID} ya tiene ${existingStops.length} paradas.`);
      
      // Forzar la eliminación y reimportación
      console.log(`Eliminando ${existingStops.length} paradas existentes...`);
      await db.delete(busStops).where(eq(busStops.routeId, TARGET_ROUTE_ID));
      console.log('Paradas eliminadas correctamente.');
    }
    
    console.log(`Procesando ${stopsData.features.length} paradas para la ruta ${TARGET_ROUTE_ID}`);
    
    // Procesar cada parada
    let totalImported = 0;
    
    for (let i = 0; i < stopsData.features.length; i++) {
      const feature = stopsData.features[i];
      
      if (!feature.geometry || !feature.geometry.coordinates || !feature.properties) {
        console.warn(`Parada #${i} no tiene geometría o propiedades válidas, saltando...`);
        continue;
      }
      
      const [longitude, latitude] = feature.geometry.coordinates;
      const isTerminal = i === 0 || i === stopsData.features.length - 1;
      const terminalType = isTerminal ? (i === 0 ? 'inicio' : 'fin') : '';
      const stopName = `Parada ${i + 1}`;
      
      // Insertar parada en la base de datos
      await db.insert(busStops).values({
        routeId: TARGET_ROUTE_ID,
        name: stopName,
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        isTerminal,
        terminalType
      });
      
      totalImported++;
    }
    
    console.log(`Se importaron ${totalImported} paradas para la ruta ${TARGET_ROUTE_ID}`);
    return { totalImported };
  } catch (error) {
    console.error('Error en importStopsFromJson:', error);
    return { totalImported: 0 };
  }
}

// Ejecutar la función
importStopsFromJson()
  .then((result) => {
    console.log(`Proceso completado con éxito. Se importaron ${result.totalImported} paradas.`);
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en el proceso:', error);
    process.exit(1);
  });