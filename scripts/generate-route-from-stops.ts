import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Configura WebSocket para Neon
neonConfig.webSocketConstructor = ws;

// Configura conexión a la base de datos
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface StopCoordinates {
  id: number;
  latitude: number;
  longitude: number;
}

async function generateRouteFromStops() {
  try {
    console.log('Generando ruta a partir de las paradas existentes...');
    
    // Obtener todas las paradas de la ruta temporal (ID 1)
    const stopsResult = await pool.query(`
      SELECT id, latitude, longitude 
      FROM bus_stops 
      WHERE route_id = 1
    `);
    
    if (stopsResult.rowCount === 0) {
      throw new Error('No se encontraron paradas para la ruta temporal (ID 1)');
    }
    
    console.log(`Encontradas ${stopsResult.rowCount} paradas para la ruta temporal`);
    
    // Convertir coordenadas de texto a números
    const stops: StopCoordinates[] = stopsResult.rows.map(row => ({
      id: row.id,
      latitude: parseFloat(row.latitude),
      longitude: parseFloat(row.longitude)
    }));
    
    // Generar un GeoJSON que represente una línea que conecte todas las paradas
    // Para simplificar, conectaremos las paradas por su id (orden)
    stops.sort((a, b) => a.id - b.id);
    
    // Extraer las coordenadas para el GeoJSON
    const coordinates = stops.map(stop => [stop.longitude, stop.latitude]);
    
    // Crear el objeto GeoJSON
    const geoJSON = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            id: 1,
            name: "Ruta Temporal",
            shortName: "RT",
            color: "#FFDD00"
          },
          geometry: {
            type: "LineString",
            coordinates: coordinates
          }
        }
      ]
    };
    
    // Actualizar la ruta con el nuevo GeoJSON
    await pool.query(`
      UPDATE bus_routes 
      SET geo_json = $1 
      WHERE id = 1
    `, [JSON.stringify(geoJSON)]);
    
    console.log('Ruta temporal actualizada con las paradas conectadas en orden de ID');
    
    // Opcional: Actualizar también el color y otros detalles para mejorar la visualización
    await pool.query(`
      UPDATE bus_routes 
      SET color = '#FFDD00', 
          name = 'Todas las Paradas de Xalapa', 
          short_name = 'XAL'
      WHERE id = 1
    `);
    
    console.log('Detalles de la ruta temporal actualizados para mejor visualización');
    
  } catch (error) {
    console.error('Error al generar ruta desde paradas:', error);
  } finally {
    // Cerrar la conexión
    await pool.end();
    
    console.log('Proceso completado');
  }
}

// Ejecutar función principal
generateRouteFromStops();