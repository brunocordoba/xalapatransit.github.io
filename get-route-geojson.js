import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Cargar variables de entorno
config();

// Configurar WebSocket para Neon
neonConfig.webSocketConstructor = ws;

// Configurar conexión a la base de datos
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const routeId = process.argv[2] || 702;
    
    // Obtener la ruta de la base de datos
    const result = await pool.query('SELECT id, name, geo_json FROM bus_routes WHERE id = $1', [routeId]);
    
    if (result.rows.length === 0) {
      console.error(`Ruta con ID ${routeId} no encontrada`);
      return;
    }
    
    const route = result.rows[0];
    console.log(`Ruta: ${route.id} - ${route.name}`);
    
    // Verificar campo geoJSON
    if (route.geo_json) {
      console.log('geoJSON:');
      if (typeof route.geo_json === 'string') {
        try {
          const parsed = JSON.parse(route.geo_json);
          console.log(JSON.stringify(parsed, null, 2));
        } catch (e) {
          console.log('Error al parsear geoJSON:', e.message);
          console.log('Contenido raw:', route.geo_json);
        }
      } else {
        console.log(JSON.stringify(route.geo_json, null, 2));
      }
    } else {
      console.log('La ruta no tiene campo geoJSON');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main();
