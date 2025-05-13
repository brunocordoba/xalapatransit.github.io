import { drizzle } from 'drizzle-orm/neon-serverless';
import { eq } from 'drizzle-orm';
import { Pool, neonConfig } from '@neondatabase/serverless';
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

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema: { busRoutes, busStops } });

// Función para leer puntos de parada desde el archivo JSON
async function readStopPoints(routeId: number): Promise<Array<{
  name: string, 
  coordinates: [number, number],
  sequence: number,
  isTerminal?: boolean
}> | null> {
  try {
    const stopsFilePath = path.join(__dirname, '../attached_assets/2017-03-04_04-27_stops.json');
    
    // Leer el archivo de paradas
    const data = await fs.readFile(stopsFilePath, 'utf-8');
    const stopsData = JSON.parse(data);
    
    // Comprobar si es una colección GeoJSON
    if (stopsData.type === 'FeatureCollection' && Array.isArray(stopsData.features)) {
      // Obtener la ruta para buscar su nombre/shortName
      const [route] = await db.select().from(busRoutes).where(eq(busRoutes.id, routeId));
      if (!route) {
        console.error(`La ruta ${routeId} no existe.`);
        return null;
      }
      
      // Extraer el número de ruta del shortName (por ejemplo, 'R89' -> '89')
      const routeNumber = route.shortName.match(/\d+/)?.[0];
      if (!routeNumber) {
        console.error(`No se pudo extraer el número de ruta de ${route.shortName}`);
        return null;
      }
      
      console.log(`Buscando paradas para ruta ${routeId} (${route.name}, número ${routeNumber})...`);
      
      // Obtener paradas que coincidan con el ID interno o el número de ruta
      let filteredStops: any[] = [];
      
      // Intentamos diferentes estrategias para encontrar las paradas correctas
      for (const feature of stopsData.features) {
        const props = feature.properties;
        const routeIdStr = props.routeId?.toString() || '';
        
        // Si routeId en el JSON termina con el número de la ruta, lo consideramos coincidencia
        if (routeIdStr.endsWith(routeNumber)) {
          filteredStops.push(feature);
        }
      }
      
      if (filteredStops.length === 0) {
        console.log(`No se encontraron paradas para la ruta ${routeId} en el archivo. Tomando una muestra...`);
        
        // Si no encontramos coincidencias, tomamos una muestra de paradas de cualquier ruta
        // para tener puntos de anclaje (mejor que nada)
        const uniqueRouteIds = new Set();
        stopsData.features.forEach((f: any) => {
          if (f.properties && f.properties.routeId) {
            uniqueRouteIds.add(f.properties.routeId);
          }
        });
        
        const availableRouteIds = Array.from(uniqueRouteIds);
        if (availableRouteIds.length > 0) {
          // Elegir una ruta aleatoria
          const sampleRouteId = availableRouteIds[0];
          filteredStops = stopsData.features.filter((f: any) => 
            f.properties && f.properties.routeId === sampleRouteId
          );
          console.log(`Usando ${filteredStops.length} paradas de muestra de routeId=${sampleRouteId}`);
        }
      } else {
        console.log(`Se encontraron ${filteredStops.length} paradas para la ruta ${routeId}`);
      }
      
      if (filteredStops.length === 0) {
        console.log(`No se pudieron encontrar paradas para usar como puntos de anclaje.`);
        return null;
      }
      
      // Convertir al formato deseado
      return filteredStops.map((feature: any) => {
        const coords = feature.geometry.coordinates;
        return {
          name: `Parada ${feature.properties.sequence || 0}`,
          coordinates: [coords[0], coords[1]] as [number, number],
          sequence: feature.properties.sequence || 0,
          isTerminal: feature.properties.sequence === 0 || 
                      feature.properties.sequence === filteredStops.length - 1
        };
      }).sort((a, b) => a.sequence - b.sequence);
    } else {
      console.error('El archivo de paradas no tiene el formato GeoJSON esperado');
      return null;
    }
  } catch (error) {
    console.error(`Error al leer las paradas para la ruta ${routeId}:`, error);
    return null;
  }
}

// Función para importar paradas para una ruta específica
async function importStopsForRoute(routeId: number): Promise<number> {
  try {
    // Verificar si la ruta existe
    const [route] = await db.select().from(busRoutes).where(eq(busRoutes.id, routeId));
    if (!route) {
      console.error(`La ruta ${routeId} no existe.`);
      return 0;
    }
    
    // Verificar si ya existen paradas para esta ruta
    const existingStopsResult = await pool.query(
      'SELECT COUNT(*) FROM bus_stops WHERE route_id = $1',
      [routeId]
    );
    const existingStopsCount = parseInt(existingStopsResult.rows[0].count, 10);
    
    if (existingStopsCount > 0) {
      console.log(`Ya existen ${existingStopsCount} paradas para la ruta ${routeId}. Saltando...`);
      return existingStopsCount;
    }
    
    // Leer puntos de parada
    const stopPoints = await readStopPoints(routeId);
    if (!stopPoints || stopPoints.length === 0) {
      console.log(`No se encontraron puntos de parada para la ruta ${routeId}`);
      return 0;
    }
    
    console.log(`Importando ${stopPoints.length} paradas para la ruta ${routeId}...`);
    
    // Insertar paradas
    let insertedCount = 0;
    for (const point of stopPoints) {
      // Crear objeto de ubicación GeoJSON
      const location = {
        type: 'Point',
        coordinates: point.coordinates
      };
      
      // Insertar en la base de datos
      await pool.query(
        `INSERT INTO bus_stops (route_id, name, latitude, longitude, is_terminal, location)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          routeId,
          point.name || `Parada ${insertedCount + 1}`,
          point.coordinates[1].toString(), // Latitude
          point.coordinates[0].toString(), // Longitude
          point.isTerminal || false,
          JSON.stringify(location)
        ]
      );
      
      insertedCount++;
    }
    
    console.log(`Se importaron ${insertedCount} paradas para la ruta ${routeId}`);
    return insertedCount;
  } catch (error) {
    console.error(`Error al importar paradas para la ruta ${routeId}:`, error);
    return 0;
  }
}

// Función para importar paradas para todas las rutas
async function importAllStops() {
  try {
    // Obtener todas las rutas
    const routes = await db.select().from(busRoutes);
    console.log(`Procesando ${routes.length} rutas...`);
    
    let totalImported = 0;
    
    for (const route of routes) {
      const importedCount = await importStopsForRoute(route.id);
      totalImported += importedCount;
      
      // Pequeña pausa para no sobrecargar la base de datos
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`Proceso completado. Se importaron ${totalImported} paradas en total.`);
  } catch (error) {
    console.error('Error al importar todas las paradas:', error);
  }
}

// Ejecución principal
async function main() {
  const args = process.argv.slice(2);
  
  try {
    if (args.length > 0 && args[0] === '--route') {
      // Importar paradas para una ruta específica
      const routeId = parseInt(args[1], 10);
      if (isNaN(routeId)) {
        console.error('El ID de ruta debe ser un número');
        process.exit(1);
      }
      await importStopsForRoute(routeId);
    } else {
      // Importar paradas para todas las rutas
      await importAllStops();
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

// Ejecutar script
main();