import * as fs from 'fs';
import * as path from 'path';
import { db } from '../server/db';
import { busRouteStops as stops, insertBusRouteStopSchema } from '../shared/schema';
import { eq } from 'drizzle-orm';

/**
 * Función para importar paradas desde un archivo GeoJSON
 */
async function importStopsFromGeoJSON(routeId: number, geojsonPath: string) {
  console.log(`Importando paradas para la ruta ${routeId} desde: ${geojsonPath}`);
  
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
    const existingStops = await db.select({ count: stops.id.count() })
      .from(stops)
      .where(eq(stops.routeId, routeId));
    
    const existingCount = Number(existingStops[0]?.count || 0);
    console.log(`La ruta ${routeId} tiene ${existingCount} paradas existentes.`);
    
    // Eliminar paradas existentes si es necesario
    if (existingCount > 0) {
      console.log(`Eliminando ${existingCount} paradas existentes para la ruta ${routeId}...`);
      await db.delete(stops).where(eq(stops.routeId, routeId));
    }
    
    // Filtrar por rutas específicas o usar todas
    const routeFeatures = geojson.features.filter((feature: any) => {
      if (routeId >= 82 && routeId <= 100) {
        // Para estas rutas específicas, usamos sus coordenadas porque no tenemos el routeId exacto
        return true;
      } else {
        // Para otras rutas, filtramos por routeId
        return (feature.properties && feature.properties.routeId === routeId.toString());
      }
    });
    
    if (routeFeatures.length === 0) {
      console.log(`No se encontraron paradas para la ruta ${routeId} en el archivo.`);
      return;
    }
    
    console.log(`Procesando ${routeFeatures.length} paradas para la ruta ${routeId}`);
    
    // Importar cada parada
    let insertedCount = 0;
    for (let i = 0; i < routeFeatures.length; i++) {
      const feature = routeFeatures[i];
      
      if (feature.geometry && feature.geometry.type === 'Point' && feature.geometry.coordinates) {
        const coordinates = feature.geometry.coordinates;
        const [longitude, latitude] = coordinates;
        
        // Crear la parada
        try {
          const stopData = {
            routeId,
            name: `Parada ${i+1}`,
            sequence: i,
            geoJSON: {
              type: "Feature",
              properties: {
                name: `Parada ${i+1}`,
                sequence: i
              },
              geometry: {
                type: "Point",
                coordinates: [longitude, latitude]
              }
            }
          };
          
          // Validar los datos con el esquema de inserción
          const parsedData = insertBusRouteStopSchema.parse(stopData);
          
          // Insertar la parada en la base de datos
          await db.insert(stops).values(parsedData);
          insertedCount++;
          
          if (insertedCount % 10 === 0) {
            console.log(`Insertadas ${insertedCount} paradas...`);
          }
        } catch (error) {
          console.error(`Error creando parada ${i+1} para ruta ${routeId}:`, error);
        }
      }
    }
    
    // Actualizar el contador de paradas en la ruta
    if (insertedCount > 0) {
      await db.execute`
        UPDATE bus_routes
        SET stops_count = ${insertedCount}
        WHERE id = ${routeId}
      `;
    }
    
    console.log(`✅ Se insertaron ${insertedCount} paradas para la ruta ${routeId}`);
    
  } catch (error) {
    console.error(`Error importando paradas para ruta ${routeId}:`, error);
  }
}

/**
 * Función principal para procesar un rango de rutas
 */
async function processStopsForRouteRange(startId: number, endId: number) {
  console.log(`Procesando paradas para rutas desde ${startId} hasta ${endId}`);
  
  const stopsGeoJSON = './attached_assets/2017-03-04_04-27_stops.json';
  
  for (let routeId = startId; routeId <= endId; routeId++) {
    await importStopsFromGeoJSON(routeId, stopsGeoJSON);
  }
  
  console.log(`Procesamiento de paradas para rutas ${startId}-${endId} completado.`);
}

/**
 * Función principal
 */
async function main() {
  if (process.argv.length < 4) {
    console.error('Uso: npx tsx scripts/process-stops-from-attached.ts <id_inicial> <id_final>');
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