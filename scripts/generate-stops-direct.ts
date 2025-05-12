import { pool } from '../server/db';
import { busStops, busRoutes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

const db = drizzle(pool);

// Procesar un rango específico de rutas, desde startId hasta endId inclusive
const startId = parseInt(process.argv[2] || '359', 10);
const endId = parseInt(process.argv[3] || '380', 10);

console.log(`Procesando rutas desde ID ${startId} hasta ${endId}`);

// Función para generar paradas para una ruta
async function generateStopsForRoute(routeId: number): Promise<number> {
  try {
    // Obtener la ruta de la base de datos
    const routes = await db.select().from(busRoutes).where(eq(busRoutes.id, routeId));
    if (routes.length === 0) {
      console.log(`No se encontró la ruta con ID ${routeId}`);
      return 0;
    }
    
    const route = routes[0];
    
    // Verificar si ya tiene paradas
    const existingStops = await db.select().from(busStops).where(eq(busStops.routeId, routeId));
    if (existingStops.length > 0) {
      console.log(`La ruta ${routeId} ya tiene ${existingStops.length} paradas, saltando...`);
      return 0;
    }
    
    console.log(`Generando paradas para la ruta ${routeId} - ${route.name}`);
    
    // Extraer las coordenadas del GeoJSON
    let coordinates: [number, number][] = [];
    try {
      const geoJSON = typeof route.geoJSON === 'string'
        ? JSON.parse(route.geoJSON)
        : route.geoJSON;
      
      if (geoJSON.type === 'Feature' && geoJSON.geometry && geoJSON.geometry.coordinates) {
        coordinates = geoJSON.geometry.coordinates;
      } else if (geoJSON.type === 'FeatureCollection' && geoJSON.features && geoJSON.features.length > 0) {
        coordinates = geoJSON.features[0].geometry.coordinates;
      } else if (geoJSON.coordinates) {
        coordinates = geoJSON.coordinates;
      } else if (Array.isArray(geoJSON)) {
        coordinates = geoJSON;
      }
    } catch (error) {
      console.error(`Error al extraer coordenadas para la ruta ${routeId}:`, error);
      return 0;
    }
    
    if (!coordinates || coordinates.length < 2) {
      console.log(`No hay suficientes coordenadas para la ruta ${routeId}`);
      return 0;
    }
    
    console.log(`La ruta ${routeId} tiene ${coordinates.length} puntos`);
    
    // Calcular número de paradas según la longitud de la ruta
    const numStops = Math.min(15, Math.max(5, Math.floor(coordinates.length / 30)));
    const interval = Math.floor(coordinates.length / numStops);
    
    console.log(`Generando ${numStops} paradas con un intervalo de ${interval} puntos`);
    
    // Generar paradas
    let stopsAdded = 0;
    
    // Primera parada (terminal de inicio)
    await db.insert(busStops).values({
      routeId,
      name: `Terminal Inicio ${routeId}`,
      latitude: coordinates[0][1].toString(),
      longitude: coordinates[0][0].toString(),
      isTerminal: true,
      terminalType: 'inicio'
    });
    stopsAdded++;
    
    // Paradas intermedias
    for (let i = 1; i < numStops - 1; i++) {
      const index = i * interval;
      if (index < coordinates.length) {
        await db.insert(busStops).values({
          routeId,
          name: `Parada ${routeId}-${i}`,
          latitude: coordinates[index][1].toString(),
          longitude: coordinates[index][0].toString(),
          isTerminal: false,
          terminalType: ''
        });
        stopsAdded++;
      }
    }
    
    // Última parada (terminal final)
    await db.insert(busStops).values({
      routeId,
      name: `Terminal Fin ${routeId}`,
      latitude: coordinates[coordinates.length - 1][1].toString(),
      longitude: coordinates[coordinates.length - 1][0].toString(),
      isTerminal: true,
      terminalType: 'fin'
    });
    stopsAdded++;
    
    console.log(`Se añadieron ${stopsAdded} paradas a la ruta ${routeId}`);
    return stopsAdded;
  } catch (error) {
    console.error(`Error generando paradas para la ruta ${routeId}:`, error);
    return 0;
  }
}

// Función principal para procesar el rango de rutas
async function processRouteRange() {
  let totalStops = 0;
  let routesProcessed = 0;
  
  // Procesar cada ruta en el rango
  for (let id = startId; id <= endId; id++) {
    const stopsAdded = await generateStopsForRoute(id);
    if (stopsAdded > 0) {
      totalStops += stopsAdded;
      routesProcessed++;
    }
  }
  
  console.log(`
Proceso completado:
- Rutas procesadas: ${routesProcessed}
- Total de paradas añadidas: ${totalStops}
  `);
}

// Ejecutar el proceso
processRouteRange()
  .then(() => {
    console.log('Proceso finalizado correctamente.');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en el proceso:', error);
    process.exit(1);
  });