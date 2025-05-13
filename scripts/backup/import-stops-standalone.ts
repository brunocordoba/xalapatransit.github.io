import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import * as fs from 'fs';
import path from 'path';

// Configura WebSocket para Neon
neonConfig.webSocketConstructor = ws;

// Configura conexión a la base de datos
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface Stop {
  id: string;
  latitude: number;
  longitude: number;
}

async function importAllStops() {
  try {
    console.log('Iniciando importación de todas las paradas de Xalapa...');
    
    // Leer el archivo GeoJSON
    const filePath = path.resolve('./attached_assets/stops.geojson');
    const stopsData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    if (!stopsData || !stopsData.features || !Array.isArray(stopsData.features)) {
      console.error('Formato de archivo no válido o no contiene paradas');
      return;
    }
    
    console.log(`Encontradas ${stopsData.features.length} paradas en el archivo`);
    
    // Primero, crear una ruta temporal para poder asociar las paradas
    console.log('Creando ruta temporal para asociar las paradas...');
    try {
      // Verificar si la ruta ya existe
      const routeExists = await pool.query('SELECT id FROM bus_routes WHERE id = 1');
      
      if (routeExists.rowCount === 0) {
        // Crear la ruta temporal si no existe
        await pool.query(`
          INSERT INTO bus_routes (id, name, short_name, color, frequency, schedule_start, schedule_end, 
          stops_count, approximate_time, zone, popular, geo_json)
          VALUES (1, 'Ruta Temporal', 'RT', '#FFDD00', '10-15 min', '05:00', '23:00', 
          0, '1 hora', 'Norte', false, '{"type":"FeatureCollection","features":[]}')
        `);
        console.log('Ruta temporal creada (ID: 1)');
      } else {
        console.log('Ruta temporal ya existe (ID: 1)');
      }
    } catch (error) {
      console.error('Error al verificar/crear ruta temporal:', error);
      throw error; // Terminar si no podemos crear la ruta
    }
    
    // Procesar cada parada del archivo GeoJSON
    const stops: Stop[] = [];
    
    for (const feature of stopsData.features) {
      if (
        feature.type === 'Feature' &&
        feature.properties && 
        feature.properties.id &&
        feature.geometry && 
        feature.geometry.type === 'Point' &&
        Array.isArray(feature.geometry.coordinates) &&
        feature.geometry.coordinates.length >= 2
      ) {
        const stop: Stop = {
          id: feature.properties.id,
          longitude: feature.geometry.coordinates[0],
          latitude: feature.geometry.coordinates[1]
        };
        stops.push(stop);
      }
    }
    
    console.log(`Procesando ${stops.length} paradas válidas...`);
    
    // Primero, truncar la tabla de paradas existente
    console.log('Limpiando tabla de paradas existentes...');
    try {
      await pool.query('DELETE FROM bus_stops');
      console.log('Tabla de paradas limpiada exitosamente');
    } catch (error) {
      console.error('Error al limpiar la tabla de paradas:', error);
      // Continuar de todos modos
    }
    
    // Realizar una inserción masiva para mejor rendimiento
    const batchSize = 100;
    let processed = 0;
    
    for (let i = 0; i < stops.length; i += batchSize) {
      const batch = stops.slice(i, i + batchSize);
      
      // Generar consulta con múltiples valores adaptada a la estructura existente
      const values = batch.map((stop, index) => {
        const base = index * 6;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
      }).join(', ');
      
      const params = batch.flatMap(stop => [
        1, // route_id (ruta temporal)
        `Parada ${stop.id}`, // name
        stop.latitude.toString(), // latitude como texto
        stop.longitude.toString(), // longitude como texto
        false, // is_terminal
        JSON.stringify({ type: "Point", coordinates: [stop.longitude, stop.latitude] }) // location como JSONB
      ]);
      
      const query = `
        INSERT INTO bus_stops (route_id, name, latitude, longitude, is_terminal, location)
        VALUES ${values}
      `;
      
      try {
        await pool.query(query, params);
        processed += batch.length;
        console.log(`Progreso: ${processed}/${stops.length} paradas procesadas`);
      } catch (error) {
        console.error(`Error al procesar lote ${i} - ${i + batch.length}:`, error);
      }
    }
    
    // Actualizar el contador de paradas en la ruta temporal
    if (processed > 0) {
      try {
        await pool.query('UPDATE bus_routes SET stops_count = $1 WHERE id = 1', [processed]);
        console.log(`Contador de paradas actualizado en la ruta temporal: ${processed} paradas`);
      } catch (error) {
        console.error('Error al actualizar contador de paradas:', error);
      }
    }
    
    console.log(`Importación completada. ${processed} paradas importadas.`);
  } catch (error) {
    console.error('Error durante la importación:', error);
  } finally {
    // Cerrar la conexión
    await pool.end();
  }
}

// Ejecutar función principal
importAllStops();