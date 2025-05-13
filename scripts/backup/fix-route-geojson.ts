import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Configura WebSocket para Neon
neonConfig.webSocketConstructor = ws;

// Configura conexión a la base de datos
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fixRouteGeoJSON() {
  try {
    console.log('Corrigiendo el formato GeoJSON de la ruta temporal (ID: 1)...');
    
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
    const coordinates = stopsResult.rows.map(row => {
      // Asegurarse de que las coordenadas sean números
      const longitude = parseFloat(row.longitude);
      const latitude = parseFloat(row.latitude);
      
      // Asegurarse de que sean coordenadas válidas
      if (isNaN(longitude) || isNaN(latitude)) {
        console.warn(`Coordenadas inválidas para la parada ${row.id}: [${row.longitude}, ${row.latitude}]`);
        return null;
      }
      
      return [longitude, latitude];
    }).filter(coord => coord !== null);
    
    console.log(`Generando GeoJSON con ${coordinates.length} coordenadas válidas`);
    
    // Crear un GeoJSON simplificado que sea compatible con la aplicación
    // Formato más simple ya que el componente MapView.tsx tiene un caso específico para este formato
    const simplifiedGeoJSON = {
      coordinates: coordinates
    };
    
    // Actualizar la ruta con el nuevo GeoJSON simplificado
    await pool.query(`
      UPDATE bus_routes 
      SET geo_json = $1 
      WHERE id = 1
    `, [JSON.stringify(simplifiedGeoJSON)]);
    
    console.log('GeoJSON de la ruta temporal actualizado con un formato compatible');
    
    // Actualizar otros detalles para mejorar la visualización
    await pool.query(`
      UPDATE bus_routes 
      SET color = '#FFDD00', 
          name = 'Todas las Paradas de Xalapa', 
          short_name = 'XAL'
      WHERE id = 1
    `);
    
    console.log('Proceso completado con éxito');
    
  } catch (error) {
    console.error('Error al corregir el GeoJSON de la ruta:', error);
  } finally {
    // Cerrar la conexión
    await pool.end();
  }
}

// Ejecutar función principal
fixRouteGeoJSON();