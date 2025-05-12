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

async function importStopsFromJson() {
  try {
    // Ruta al archivo JSON de paradas
    const stopsJsonPath = path.join(__dirname, '..', 'attached_assets', '2017-03-04_04-27_stops.json');
    
    console.log(`Importando paradas desde ${stopsJsonPath}`);
    
    // Verificar si el archivo existe
    if (!fs.existsSync(stopsJsonPath)) {
      console.error(`Archivo no encontrado: ${stopsJsonPath}`);
      return;
    }
    
    // Leer el archivo JSON
    const stopsJson = fs.readFileSync(stopsJsonPath, 'utf-8');
    const stopsData = JSON.parse(stopsJson);
    
    // Verificar que tiene el formato correcto (GeoJSON FeatureCollection)
    if (!stopsData.type || stopsData.type !== 'FeatureCollection' || !Array.isArray(stopsData.features)) {
      console.error('El archivo de paradas no tiene el formato GeoJSON FeatureCollection esperado');
      return;
    }
    
    // Obtener todas las rutas para el mapeo de IDs
    const routes = await db.select().from(busRoutes);
    console.log(`Se encontraron ${routes.length} rutas en la base de datos`);
    
    // Agrupar las paradas por routeId
    const stopsByRouteId = new Map<string, any[]>();
    
    stopsData.features.forEach(feature => {
      const properties = feature.properties;
      const routeId = properties.routeId;
      
      if (!stopsByRouteId.has(routeId)) {
        stopsByRouteId.set(routeId, []);
      }
      
      stopsByRouteId.get(routeId)?.push({
        ...properties,
        coordinates: feature.geometry.coordinates
      });
    });
    
    console.log(`Se encontraron ${stopsByRouteId.size} conjuntos de paradas para diferentes rutas`);
    
    // Para cada conjunto de paradas, buscar la ruta correspondiente y crear las paradas
    let totalImported = 0;
    let routesWithStops = 0;
    
    // Como no tenemos una manera directa de mapear los IDs del JSON a los IDs de nuestra DB,
    // lo haremos secuencialmente, es decir, asignaremos el primer conjunto de paradas a la primera ruta, etc.
    const routeIds = Array.from(stopsByRouteId.keys());
    const validRouteIds = routes.map(r => r.id);
    
    for (let i = 0; i < Math.min(routeIds.length, validRouteIds.length); i++) {
      const jsonRouteId = routeIds[i];
      const dbRouteId = validRouteIds[i];
      const stops = stopsByRouteId.get(jsonRouteId) || [];
      
      // Verificar si ya hay paradas para esta ruta
      const existingStops = await db.select()
        .from(busStops)
        .where(eq(busStops.routeId, dbRouteId));
      
      if (existingStops.length > 0) {
        console.log(`La ruta ${dbRouteId} ya tiene ${existingStops.length} paradas, saltando...`);
        continue;
      }
      
      console.log(`Procesando ${stops.length} paradas para la ruta ${dbRouteId} (JSON ID: ${jsonRouteId})`);
      
      // Procesar cada parada
      for (let j = 0; j < stops.length; j++) {
        const stop = stops[j];
        const [longitude, latitude] = stop.coordinates;
        const isTerminal = j === 0 || j === stops.length - 1;
        const terminalType = isTerminal ? (j === 0 ? 'inicio' : 'fin') : '';
        const stopName = `Parada ${dbRouteId}-${j + 1}`;
        
        // Insertar parada en la base de datos
        await db.insert(busStops).values({
          routeId: dbRouteId,
          name: stopName,
          latitude: latitude.toString(),
          longitude: longitude.toString(),
          isTerminal,
          terminalType
        });
        
        totalImported++;
      }
      
      routesWithStops++;
      console.log(`Se importaron ${stops.length} paradas para la ruta ${dbRouteId}`);
    }
    
    console.log(`Proceso completado. Se importaron ${totalImported} paradas para ${routesWithStops} rutas.`);
    return { totalImported, routesWithStops };
  } catch (error) {
    console.error('Error en importStopsFromJson:', error);
    return { totalImported: 0, routesWithStops: 0 };
  }
}

// Ejecutar la función
importStopsFromJson()
  .then((result) => {
    const totalImported = result?.totalImported || 0;
    const routesWithStops = result?.routesWithStops || 0;
    console.log(`Proceso completado con éxito. Se importaron ${totalImported} paradas para ${routesWithStops} rutas.`);
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en el proceso:', error);
    process.exit(1);
  });