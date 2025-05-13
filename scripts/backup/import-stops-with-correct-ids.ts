import * as fs from 'fs';
import * as path from 'path';
import { db } from '../server/db';

// Mapa de número de ruta a ID real en la base de datos
interface RouteMapping {
  routeNumber: number;
  dbId: number;
}

async function getRouteNumberToIdMap(): Promise<Map<number, number>> {
  console.log('Obteniendo mapeo de números de ruta a IDs...');
  
  const routeMap = new Map<number, number>();
  
  try {
    const result = await db.execute(`
      SELECT id, name FROM bus_routes 
      WHERE name SIMILAR TO 'Ruta [0-9]+%'
      ORDER BY name
    `);
    
    for (const row of result.rows) {
      // Extraer el número de la ruta del nombre
      const routeName = row.name as string;
      const routeNumberMatch = routeName.match(/Ruta (\d+)/);
      
      if (routeNumberMatch && routeNumberMatch[1]) {
        const routeNumber = parseInt(routeNumberMatch[1], 10);
        const dbId = row.id as number;
        
        routeMap.set(routeNumber, dbId);
        console.log(`Ruta ${routeNumber} -> ID: ${dbId}`);
      }
    }
    
  } catch (error) {
    console.error('Error obteniendo mapeo de rutas:', error);
  }
  
  return routeMap;
}

/**
 * Función para importar paradas desde un archivo GeoJSON
 */
async function importStopsFromGeoJSON(routeNumber: number, dbId: number, geojsonPath: string) {
  console.log(`Importando paradas para la ruta ${routeNumber} (ID: ${dbId}) desde: ${geojsonPath}`);
  
  try {
    if (!fs.existsSync(geojsonPath)) {
      console.error(`El archivo ${geojsonPath} no existe.`);
      return;
    }
    
    // Leer el archivo GeoJSON
    const geojsonStr = fs.readFileSync(geojsonPath, 'utf8');
    const geojson = JSON.parse(geojsonStr);
    
    // Verificar si el GeoJSON tiene la estructura esperada
    if (!geojson || !geojson.features || !geojson.features.length) {
      console.error('El archivo GeoJSON no tiene la estructura esperada.');
      return;
    }
    
    // Contar paradas existentes
    const result = await db.execute(`SELECT COUNT(*) as count FROM bus_route_stops WHERE route_id = ${dbId}`);
    
    const existingCount = Number(result.rows[0]?.count || 0);
    console.log(`La ruta ${routeNumber} (ID: ${dbId}) tiene ${existingCount} paradas existentes.`);
    
    // Eliminar paradas existentes si es necesario
    if (existingCount > 0) {
      console.log(`Eliminando ${existingCount} paradas existentes para la ruta ${routeNumber}...`);
      await db.execute(`DELETE FROM bus_route_stops WHERE route_id = ${dbId}`);
    }
    
    // Usar todas las paradas del archivo para esta ruta
    const stopsFeatures = geojson.features.filter((feature: any) => 
      feature.geometry && feature.geometry.type === 'Point' && feature.geometry.coordinates
    );
    
    if (stopsFeatures.length === 0) {
      console.log(`No se encontraron paradas para la ruta ${routeNumber} en el archivo.`);
      return;
    }
    
    // Dividir en segmentos para crear un número razonable de paradas
    // Tomaremos aproximadamente 20-30 paradas por ruta
    const totalFeatures = stopsFeatures.length;
    const step = Math.max(1, Math.floor(totalFeatures / 25));
    const selectedFeatures = [];
    
    for (let i = 0; i < totalFeatures; i += step) {
      selectedFeatures.push(stopsFeatures[i]);
    }
    
    console.log(`Seleccionadas ${selectedFeatures.length} de ${totalFeatures} paradas para la ruta ${routeNumber}`);
    
    // Importar cada parada
    let insertedCount = 0;
    for (let i = 0; i < selectedFeatures.length; i++) {
      const feature = selectedFeatures[i];
      
      if (feature.geometry && feature.geometry.coordinates) {
        const coordinates = feature.geometry.coordinates;
        const [longitude, latitude] = coordinates;
        
        // Crear la parada
        try {
          const stopName = `Parada ${i+1}`;
          const geoJSON = {
            type: "Feature",
            properties: {
              name: stopName,
              sequence: i
            },
            geometry: {
              type: "Point",
              coordinates: [longitude, latitude]
            }
          };
          
          const geoJsonStr = JSON.stringify(geoJSON);
          
          // Insertar la parada en la base de datos
          await db.execute(`
            INSERT INTO bus_route_stops (route_id, name, sequence, geo_json) 
            VALUES (${dbId}, '${stopName}', ${i}, '${geoJsonStr}')
          `);
          
          insertedCount++;
          
          if (insertedCount % 5 === 0) {
            console.log(`Insertadas ${insertedCount} paradas...`);
          }
        } catch (error) {
          console.error(`Error creando parada ${i+1} para ruta ${routeNumber}:`, error);
        }
      }
    }
    
    // Actualizar el contador de paradas en la ruta
    if (insertedCount > 0) {
      await db.execute(`UPDATE bus_routes SET stops_count = ${insertedCount} WHERE id = ${dbId}`);
    }
    
    console.log(`✅ Se insertaron ${insertedCount} paradas para la ruta ${routeNumber} (ID: ${dbId})`);
    
  } catch (error) {
    console.error(`Error importando paradas para ruta ${routeNumber}:`, error);
  }
}

/**
 * Función principal para procesar un rango de rutas
 */
async function processStopsForRouteRange(startId: number, endId: number) {
  console.log(`Procesando paradas para rutas desde ${startId} hasta ${endId}`);
  
  const stopsGeoJSON = './attached_assets/2017-03-04_04-27_stops.json';
  
  // Obtener el mapeo de números de ruta a IDs de base de datos
  const routeMap = await getRouteNumberToIdMap();
  
  for (let routeNumber = startId; routeNumber <= endId; routeNumber++) {
    const dbId = routeMap.get(routeNumber);
    
    if (!dbId) {
      console.log(`No se encontró ID en la base de datos para la ruta ${routeNumber}, saltando...`);
      continue;
    }
    
    await importStopsFromGeoJSON(routeNumber, dbId, stopsGeoJSON);
  }
  
  console.log(`Procesamiento de paradas para rutas ${startId}-${endId} completado.`);
}

/**
 * Función principal
 */
async function main() {
  if (process.argv.length < 4) {
    console.error('Uso: npx tsx scripts/import-stops-with-correct-ids.ts <id_inicial> <id_final>');
    process.exit(1);
  }
  
  const startId = parseInt(process.argv[2], 10);
  const endId = parseInt(process.argv[3], 10);
  
  if (isNaN(startId) || isNaN(endId)) {
    console.error('Los IDs deben ser números válidos');
    process.exit(1);
  }
  
  await processStopsForRouteRange(startId, endId);
  console.log('Procesamiento completado.');
}

main().catch(console.error);