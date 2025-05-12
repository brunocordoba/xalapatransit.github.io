import { pool } from '../server/db';
import { busStops } from '../shared/schema';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as fs from 'fs';

const db = drizzle(pool);

// Importar paradas directamente desde un archivo JSON
async function importStopsFromJson() {
  try {
    // Leer el archivo JSON de stops
    console.log('Leyendo el archivo de paradas...');
    const stopsJsonPath = 'attached_assets/2017-03-04_04-27_stops.json';
    
    if (!fs.existsSync(stopsJsonPath)) {
      console.error(`El archivo ${stopsJsonPath} no existe.`);
      return;
    }
    
    const stopsJsonContent = fs.readFileSync(stopsJsonPath, 'utf8');
    const geoJson = JSON.parse(stopsJsonContent);
    
    // Verificar que sea un GeoJSON válido
    if (!geoJson.type || geoJson.type !== 'FeatureCollection' || !Array.isArray(geoJson.features)) {
      console.error('El formato del archivo JSON no es correcto. Se esperaba un GeoJSON FeatureCollection.');
      return;
    }
    
    console.log(`Se encontraron ${geoJson.features.length} paradas en el archivo GeoJSON.`);
    
    // Usamos las features como nuestros datos de paradas
    const stopsData = geoJson.features;
    
    // Buscar el ID correcto de la ruta 1
    const routeResult = await db.execute(sql`
      SELECT id, name FROM bus_routes WHERE name LIKE '%Ruta 1%' AND name NOT LIKE '%Ruta 10%' AND name NOT LIKE '%Ruta 11%' AND name NOT LIKE '%Ruta 12%' ORDER BY id LIMIT 1
    `);
    
    if (routeResult.rowCount === 0) {
      console.error('No se encontró la Ruta 1 en la base de datos');
      return;
    }
    
    const routeId = routeResult.rows[0].id;
    const routeName = routeResult.rows[0].name;
    console.log(`Encontrada la ruta: ${routeName} (ID: ${routeId})`);
    
    // Antes de importar, eliminamos las paradas existentes para esta ruta
    console.log('Eliminando paradas existentes...');
    await db.execute(sql`DELETE FROM bus_stops WHERE route_id = ${routeId}`);
    console.log('Paradas existentes eliminadas.');
    
    // Procesar cada parada e insertarla en la base de datos
    let insertedCount = 0;
    
    for (const stop of stopsData) {
      // Verificar que el feature tenga geometría y propiedades
      if (!stop.geometry || !stop.properties || !stop.geometry.coordinates) {
        console.warn('Parada inválida, sin geometría o propiedades:', stop);
        continue;
      }
      
      // Extraer coordenadas
      const coordinates = stop.geometry.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length !== 2) {
        console.warn('Formato de coordenadas inválido:', coordinates);
        continue;
      }
      
      // Usar el ID de la Ruta 1 (345) para todas las paradas
      const routeId = 345;
      
      // Usar el sequence para generar un nombre único si no hay uno definido
      const sequence = stop.properties.sequence !== undefined ? stop.properties.sequence : insertedCount;
      const name = stop.properties.name || `Parada ${routeId}-${sequence}`;
      
      // Coordenadas (en GeoJSON son [lon, lat])
      const longitude = coordinates[0].toString();
      const latitude = coordinates[1].toString();
      
      // Determinar si es terminal (primero o último en la secuencia)
      const isTerminal = sequence === 0 || sequence === stopsData.length - 1;
      const terminalType = sequence === 0 ? 'inicio' : (sequence === stopsData.length - 1 ? 'fin' : '');
      
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
    
    console.log(`Importación completada. Se importaron ${insertedCount} paradas de ${stopsData.length}.`);
  } catch (error) {
    console.error('Error al importar paradas desde JSON:', error);
  }
}

// Ejecutar la importación
importStopsFromJson()
  .then(() => {
    console.log('Proceso finalizado.');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en el proceso principal:', error);
    process.exit(1);
  });