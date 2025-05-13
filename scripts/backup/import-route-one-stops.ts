import { pool } from '../server/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as fs from 'fs';

const db = drizzle(pool);

// Importar paradas directamente desde un archivo JSON para la Ruta 1
async function importRouteOneStops() {
  try {
    // Verificar primero si existe el archivo
    const stopsJsonPath = 'attached_assets/2017-03-04_04-27_stops.json';
    
    if (!fs.existsSync(stopsJsonPath)) {
      console.error(`El archivo ${stopsJsonPath} no existe.`);
      return;
    }
    
    // Leer el archivo JSON de stops
    console.log('Leyendo el archivo de paradas...');
    const stopsJsonContent = fs.readFileSync(stopsJsonPath, 'utf8');
    const geoJson = JSON.parse(stopsJsonContent);
    
    // Verificar que sea un GeoJSON válido
    if (!geoJson.type || geoJson.type !== 'FeatureCollection' || !Array.isArray(geoJson.features)) {
      console.error('El formato del archivo JSON no es correcto. Se esperaba un GeoJSON FeatureCollection.');
      return;
    }
    
    console.log(`Se encontraron ${geoJson.features.length} paradas en el archivo GeoJSON.`);
    
    // Buscar el ID correcto de la ruta 1
    console.log('Buscando la Ruta 1 en la base de datos...');
    const routeResult = await db.execute(sql`
      SELECT id, name FROM bus_routes 
      WHERE name LIKE '%Ruta 1%' 
      AND name NOT LIKE '%Ruta 10%' 
      AND name NOT LIKE '%Ruta 11%' 
      AND name NOT LIKE '%Ruta 12%' 
      AND name NOT LIKE '%Ruta 13%' 
      AND name NOT LIKE '%Ruta 14%' 
      AND name NOT LIKE '%Ruta 15%' 
      AND name NOT LIKE '%Ruta 16%' 
      AND name NOT LIKE '%Ruta 17%' 
      AND name NOT LIKE '%Ruta 18%' 
      AND name NOT LIKE '%Ruta 19%' 
      ORDER BY id LIMIT 1
    `);
    
    if (!routeResult.rows || routeResult.rows.length === 0) {
      console.error('No se encontró la Ruta 1 en la base de datos');
      return;
    }
    
    const routeId = parseInt(routeResult.rows[0].id);
    const routeName = routeResult.rows[0].name;
    
    if (isNaN(routeId)) {
      console.error('El ID de la ruta no es un número válido');
      return;
    }
    
    console.log(`Encontrada la ruta: ${routeName} (ID: ${routeId})`);
    
    // Eliminar paradas existentes para la ruta 1
    console.log(`Eliminando paradas existentes para la ruta ${routeId}...`);
    await db.execute(sql`DELETE FROM bus_stops WHERE route_id = ${routeId}`);
    console.log('Paradas existentes eliminadas.');
    
    // Procesar las paradas e insertarlas
    const stopsData = geoJson.features;
    let insertedCount = 0;
    
    for (let i = 0; i < stopsData.length; i++) {
      const stop = stopsData[i];
      
      // Verificar que tenga geometría válida
      if (!stop.geometry || !stop.geometry.coordinates || !Array.isArray(stop.geometry.coordinates) || stop.geometry.coordinates.length !== 2) {
        console.warn(`Parada en índice ${i} tiene coordenadas inválidas`);
        continue;
      }
      
      // Extraer coordenadas (en GeoJSON son [lon, lat])
      const coordinates = stop.geometry.coordinates;
      const longitude = coordinates[0].toString();
      const latitude = coordinates[1].toString();
      
      // Nombre y tipo de parada
      const sequence = i;
      const name = `Parada ${routeId}-${sequence+1}`;
      const isTerminal = i === 0 || i === stopsData.length - 1;
      const terminalType = i === 0 ? 'inicio' : (i === stopsData.length - 1 ? 'fin' : '');
      
      try {
        // Insertar la parada
        await db.execute(sql`
          INSERT INTO bus_stops 
          (route_id, name, latitude, longitude, is_terminal, terminal_type)
          VALUES (${routeId}, ${name}, ${latitude}, ${longitude}, ${isTerminal}, ${terminalType})
        `);
        
        insertedCount++;
        
        // Mostrar progreso cada 10 paradas
        if (insertedCount % 10 === 0) {
          console.log(`Insertadas ${insertedCount} paradas...`);
        }
      } catch (error) {
        console.error(`Error al insertar parada ${name}:`, error);
      }
    }
    
    console.log(`Importación completada. Se importaron ${insertedCount} paradas de ${stopsData.length} para la ruta ${routeName}.`);
  } catch (error) {
    console.error('Error al importar paradas:', error);
  }
}

// Ejecutar la importación
importRouteOneStops()
  .then(() => {
    console.log('Proceso finalizado.');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en el proceso principal:', error);
    process.exit(1);
  });