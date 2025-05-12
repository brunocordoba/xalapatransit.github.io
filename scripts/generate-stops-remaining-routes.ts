import { pool } from '../server/db';
import { busStops, busRoutes } from '../shared/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, not, inArray, notInArray } from 'drizzle-orm';

const db = drizzle(pool);

// Determinar el rango de rutas a procesar desde los argumentos de la línea de comandos
const startRouteId = parseInt(process.argv[2] || '0', 10);
const endRouteId = parseInt(process.argv[3] || '10000', 10);

console.log(`Procesando rutas en el rango: ${startRouteId} - ${endRouteId}`);

// Función para generar paradas para una ruta específica
async function generateStopsForRoute(routeId: number): Promise<number> {
  try {
    console.log(`Generando paradas para la ruta ${routeId}...`);
    
    // Obtener la ruta
    const [route] = await db
      .select()
      .from(busRoutes)
      .where(eq(busRoutes.id, routeId));
    
    if (!route) {
      console.error(`No se encontró la ruta con ID ${routeId}`);
      return 0;
    }
    
    // Verificar si ya tiene paradas
    const existingStops = await db
      .select()
      .from(busStops)
      .where(eq(busStops.routeId, routeId));
    
    if (existingStops.length > 0) {
      console.log(`La ruta ${routeId} ya tiene ${existingStops.length} paradas, saltando...`);
      return 0;
    }
    
    // Extraer coordenadas del GeoJSON
    let coordinates: [number, number][] = [];
    try {
      const geoJSON = typeof route.geoJSON === 'string' 
        ? JSON.parse(route.geoJSON) 
        : route.geoJSON;
      
      if (!geoJSON) {
        console.warn(`La ruta ${routeId} no tiene GeoJSON válido`);
        return 0;
      }
      
      if (geoJSON.type === 'Feature' && geoJSON.geometry && geoJSON.geometry.coordinates) {
        coordinates = geoJSON.geometry.coordinates;
      } else if (geoJSON.type === 'FeatureCollection' && geoJSON.features && geoJSON.features.length > 0) {
        coordinates = geoJSON.features[0].geometry.coordinates;
      } else if (geoJSON.coordinates) {
        coordinates = geoJSON.coordinates;
      } else if (Array.isArray(geoJSON)) {
        coordinates = geoJSON;
      } else {
        console.warn(`Formato GeoJSON no reconocido para la ruta ${routeId}`);
        return 0;
      }
    } catch (error) {
      console.error(`Error al procesar el GeoJSON de la ruta ${routeId}:`, error);
      return 0;
    }
    
    if (!coordinates || coordinates.length < 2) {
      console.warn(`La ruta ${routeId} no tiene suficientes coordenadas (${coordinates?.length || 0})`);
      return 0;
    }
    
    console.log(`La ruta ${routeId} tiene ${coordinates.length} puntos`);
    
    // Generar paradas distribuidas a lo largo de la ruta
    // Vamos a crear un máximo de 10-15 paradas por ruta, distribuidas uniformemente
    const numStops = Math.min(15, Math.max(5, Math.floor(coordinates.length / 30)));
    const interval = Math.floor(coordinates.length / numStops);
    
    console.log(`Generando ${numStops} paradas con un intervalo de ${interval} puntos`);
    
    let stopsCreated = 0;
    
    // Creamos la parada inicial (terminal de inicio)
    await db.insert(busStops).values({
      routeId,
      name: `Terminal Inicio ${routeId}`,
      latitude: coordinates[0][1].toString(),
      longitude: coordinates[0][0].toString(),
      isTerminal: true,
      terminalType: 'inicio'
    });
    stopsCreated++;
    
    // Creamos paradas intermedias
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
        stopsCreated++;
      }
    }
    
    // Creamos la parada final (terminal de fin)
    await db.insert(busStops).values({
      routeId,
      name: `Terminal Fin ${routeId}`,
      latitude: coordinates[coordinates.length - 1][1].toString(),
      longitude: coordinates[coordinates.length - 1][0].toString(),
      isTerminal: true,
      terminalType: 'fin'
    });
    stopsCreated++;
    
    console.log(`Se crearon ${stopsCreated} paradas para la ruta ${routeId}`);
    return stopsCreated;
  } catch (error) {
    console.error(`Error al generar paradas para la ruta ${routeId}:`, error);
    return 0;
  }
}

// Función principal para generar paradas para las rutas en el rango especificado
async function generateStopsForRangeOfRoutes() {
  try {
    console.log(`Generando paradas para rutas en el rango ${startRouteId}-${endRouteId}...`);
    
    // Obtener los IDs de rutas que ya tienen paradas
    const routesWithStops = await db
      .select({ routeId: busStops.routeId })
      .from(busStops)
      .groupBy(busStops.routeId);
    
    const routeIdsWithStops = routesWithStops.map(r => r.routeId);
    console.log(`Ya hay ${routeIdsWithStops.length} rutas con paradas`);
    
    // Obtener rutas en el rango especificado que aún no tienen paradas
    const routes = await db
      .select()
      .from(busRoutes)
      .where(
        and(
          notInArray(busRoutes.id, routeIdsWithStops),
          and(
            eq(true, busRoutes.id >= startRouteId),
            eq(true, busRoutes.id <= endRouteId)
          )
        )
      )
      .orderBy(busRoutes.id);
    
    console.log(`Se encontraron ${routes.length} rutas sin paradas en el rango especificado`);
    
    let totalStops = 0;
    let routesWithNewStops = 0;
    
    // Procesar cada ruta
    for (const route of routes) {
      const stopsCreated = await generateStopsForRoute(route.id);
      if (stopsCreated > 0) {
        totalStops += stopsCreated;
        routesWithNewStops++;
      }
    }
    
    console.log(`Proceso completado. Se generaron ${totalStops} paradas para ${routesWithNewStops} rutas`);
    return { totalStops, routesWithNewStops };
  } catch (error) {
    console.error('Error en generateStopsForRangeOfRoutes:', error);
    return { totalStops: 0, routesWithNewStops: 0 };
  }
}

// Ejecutar la función
generateStopsForRangeOfRoutes()
  .then(({ totalStops, routesWithNewStops }) => {
    console.log(`Proceso completado con éxito. Se generaron ${totalStops} paradas para ${routesWithNewStops} rutas.`);
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en el proceso:', error);
    process.exit(1);
  });