import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Configura WebSocket para Neon
neonConfig.webSocketConstructor = ws;

// Configura conexión a la base de datos
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function clearAllData() {
  try {
    console.log('Iniciando limpieza completa de la base de datos...');
    
    // Primero, verificar qué tablas existen
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    const tables = tablesResult.rows.map(row => row.table_name);
    console.log('Tablas encontradas:', tables);
    
    // Eliminar primero las tablas con claves foráneas
    if (tables.includes('bus_route_stops')) {
      console.log('Borrando todas las paradas de ruta adicionales...');
      const deleteRouteStopsResult = await pool.query('DELETE FROM bus_route_stops');
      console.log(`${deleteRouteStopsResult.rowCount} paradas de ruta borradas.`);
    }
    
    // Eliminar las paradas de autobús
    if (tables.includes('bus_stops')) {
      console.log('Borrando todas las paradas de autobús...');
      const deleteStopsResult = await pool.query('DELETE FROM bus_stops');
      console.log(`${deleteStopsResult.rowCount} paradas borradas.`);
    }
    
    // Eliminar todas las rutas de autobús
    if (tables.includes('bus_routes')) {
      console.log('Borrando todas las rutas de autobús...');
      const deleteRoutesResult = await pool.query('DELETE FROM bus_routes');
      console.log(`${deleteRoutesResult.rowCount} rutas borradas.`);
    }
    
    console.log('Limpieza completada con éxito.');
  } catch (error) {
    console.error('Error al limpiar la base de datos:', error);
  } finally {
    // Cerrar la conexión
    await pool.end();
  }
}

// Ejecutar la función principal
clearAllData();