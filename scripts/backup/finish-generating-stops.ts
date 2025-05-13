import { pool } from '../server/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

const db = drizzle(pool);

// Función para generar paradas para una ruta específica
async function generateStopsForRoute(routeId: number): Promise<number> {
  try {
    console.log(`Generando paradas para la ruta ${routeId}...`);
    
    // Verificar si la ruta existe y obtener sus datos
    const [route] = await db.execute(sql`
      SELECT * FROM bus_routes WHERE id = ${routeId}
    `);
    
    if (!route) {
      console.error(`No se encontró la ruta con ID ${routeId}`);
      return 0;
    }
    
    // Verificar si ya tiene paradas
    const existingStopsResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM bus_stops WHERE route_id = ${routeId}
    `);
    
    const existingStopsCount = parseInt(existingStopsResult[0].count);
    if (existingStopsCount > 0) {
      console.log(`La ruta ${routeId} ya tiene ${existingStopsCount} paradas, saltando...`);
      return 0;
    }
    
    // Extraer coordenadas del GeoJSON
    let coordinates: [number, number][] = [];
    try {
      const geoJSON = typeof route.geo_json === 'string' 
        ? JSON.parse(route.geo_json) 
        : route.geo_json;
      
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
    // Vamos a crear entre 5 y 15 paradas por ruta, según la longitud
    const numStops = Math.min(15, Math.max(5, Math.floor(coordinates.length / 30)));
    const interval = Math.floor(coordinates.length / numStops);
    
    console.log(`Generando ${numStops} paradas con un intervalo de ${interval} puntos`);
    
    let stopsCreated = 0;
    
    // Creamos la parada inicial (terminal de inicio)
    await db.execute(sql`
      INSERT INTO bus_stops (route_id, name, latitude, longitude, is_terminal, terminal_type)
      VALUES (${routeId}, ${'Terminal Inicio ' + routeId}, ${coordinates[0][1].toString()}, ${coordinates[0][0].toString()}, ${true}, ${'inicio'})
    `);
    stopsCreated++;
    
    // Creamos paradas intermedias
    for (let i = 1; i < numStops - 1; i++) {
      const index = i * interval;
      if (index < coordinates.length) {
        await db.execute(sql`
          INSERT INTO bus_stops (route_id, name, latitude, longitude, is_terminal, terminal_type)
          VALUES (${routeId}, ${'Parada ' + routeId + '-' + i}, ${coordinates[index][1].toString()}, ${coordinates[index][0].toString()}, ${false}, ${''})
        `);
        stopsCreated++;
      }
    }
    
    // Creamos la parada final (terminal de fin)
    await db.execute(sql`
      INSERT INTO bus_stops (route_id, name, latitude, longitude, is_terminal, terminal_type)
      VALUES (${routeId}, ${'Terminal Fin ' + routeId}, ${coordinates[coordinates.length - 1][1].toString()}, ${coordinates[coordinates.length - 1][0].toString()}, ${true}, ${'fin'})
    `);
    stopsCreated++;
    
    console.log(`Se crearon ${stopsCreated} paradas para la ruta ${routeId}`);
    return stopsCreated;
  } catch (error) {
    console.error(`Error al generar paradas para la ruta ${routeId}:`, error);
    return 0;
  }
}

// Función principal para generar paradas para todas las rutas que aún no las tienen
async function generateMissingStops() {
  try {
    // Obtener rutas que no tienen paradas
    const routesWithoutStops = await db.execute(sql`
      SELECT r.id 
      FROM bus_routes r
      LEFT JOIN (
        SELECT DISTINCT route_id
        FROM bus_stops
      ) s ON r.id = s.route_id
      WHERE s.route_id IS NULL
      ORDER BY r.id
    `);
    
    console.log(`Se encontraron ${routesWithoutStops.length} rutas sin paradas`);
    
    let totalStops = 0;
    let routesWithNewStops = 0;
    
    // Procesar cada ruta
    for (const route of routesWithoutStops) {
      const stopsCreated = await generateStopsForRoute(route.id);
      if (stopsCreated > 0) {
        totalStops += stopsCreated;
        routesWithNewStops++;
      }
      
      // Pequeña pausa para no sobrecargar la base de datos
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`Proceso completado. Se generaron ${totalStops} paradas para ${routesWithNewStops} rutas`);
    return { totalStops, routesWithNewStops };
  } catch (error) {
    console.error('Error en generateMissingStops:', error);
    return { totalStops: 0, routesWithNewStops: 0 };
  }
}

// Ejecutar la función
generateMissingStops()
  .then(({ totalStops, routesWithNewStops }) => {
    console.log(`Proceso completado con éxito. Se generaron ${totalStops} paradas para ${routesWithNewStops} rutas.`);
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en el proceso:', error);
    process.exit(1);
  });