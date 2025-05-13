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
    console.log('Iniciando importación de todas las paradas...');
    
    // Leer el archivo GeoJSON
    const filePath = path.resolve('./attached_assets/stops.geojson');
    const stopsData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    if (!stopsData || !stopsData.features || !Array.isArray(stopsData.features)) {
      console.error('Formato de archivo no válido o no contiene paradas');
      return;
    }
    
    console.log(`Encontradas ${stopsData.features.length} paradas en el archivo`);
    
    // Ya sabemos la estructura de la tabla existente
    console.log('La tabla bus_stops ya existe, usaremos la estructura actual');
    
    // Primero, crear una ruta ficticia para poder asociar las paradas
    console.log('Creando ruta temporal para asociar las paradas...');
    try {
      await pool.query(`
        INSERT INTO bus_routes (id, name, short_name, color, frequency, schedule_start, schedule_end, 
        stops_count, approximate_time, zone, popular, geo_json)
        VALUES (1, 'Ruta Temporal', 'RT', '#FFDD00', '10-15 min', '05:00', '23:00', 
        0, '1 hora', 'Norte', false, '{"type":"FeatureCollection","features":[]}')
        ON CONFLICT (id) DO NOTHING
      `);
      console.log('Ruta temporal creada o ya existente (ID: 1)');
    } catch (error) {
      console.error('Error al crear ruta temporal:', error);
      // Continuar de todos modos, por si ya existe
    }
    
    // Procesar cada parada
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
    
    // Realizar una inserción masiva para mejor rendimiento
    const batchSize = 100;
    let processed = 0;
    
    for (let i = 0; i < stops.length; i += batchSize) {
      const batch = stops.slice(i, i + batchSize);
      
      // Generar consulta con múltiples valores adaptada a la estructura existente
      const values = batch.map((stop, index) => {
        return `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4})`;
      }).join(', ');
      
      const params = batch.flatMap(stop => [
        1, // route_id temporal (se asigna a la ruta 1)
        stop.latitude.toString(),
        stop.longitude.toString(),
        `Parada ${stop.id}`
      ]);
      
      const query = `
        INSERT INTO bus_stops (route_id, latitude, longitude, name)
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