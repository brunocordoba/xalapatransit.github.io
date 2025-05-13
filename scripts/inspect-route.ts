import { drizzle } from 'drizzle-orm/neon-serverless';
import { eq } from 'drizzle-orm';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Configurar WebSocket para Neon
neonConfig.webSocketConstructor = ws;

// Importar schema
import { busRoutes, busStops } from '../shared/schema';

// Configurar conexión a la base de datos
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema: { busRoutes, busStops } });

async function inspectRoute(routeId: number) {
  try {
    // Obtener la ruta
    const [route] = await db.select().from(busRoutes).where(eq(busRoutes.id, routeId));
    
    if (!route) {
      console.error(`Ruta con ID ${routeId} no encontrada`);
      return;
    }
    
    // Mostrar información de la ruta
    console.log('=== Información de la ruta ===');
    console.log(`ID: ${route.id}`);
    console.log(`Nombre: ${route.name}`);
    console.log(`Nombre corto: ${route.shortName}`);
    console.log(`Color: ${route.color}`);
    console.log(`Zona: ${route.zone}`);
    console.log(`Número de paradas: ${route.stopsCount}`);
    
    // Verificar campo geoJSON
    console.log('\n=== Información GeoJSON ===');
    if (route.geoJSON) {
      const geoJSON = typeof route.geoJSON === 'string' 
        ? JSON.parse(route.geoJSON) 
        : route.geoJSON;
      
      console.log(`Tipo: ${typeof route.geoJSON}`);
      
      if (geoJSON) {
        console.log(`Tipo de dato GeoJSON: ${geoJSON.type || 'No definido'}`);
        
        if (geoJSON.coordinates && Array.isArray(geoJSON.coordinates)) {
          console.log(`Número de puntos: ${geoJSON.coordinates.length}`);
          
          if (geoJSON.coordinates.length > 0) {
            console.log('Primer punto:', geoJSON.coordinates[0]);
            console.log('Último punto:', geoJSON.coordinates[geoJSON.coordinates.length - 1]);
          }
        } else {
          console.log('No hay coordenadas o no están en formato array');
          console.log('Estructura completa del geoJSON:');
          console.log(JSON.stringify(geoJSON, null, 2));
        }
      } else {
        console.log('geoJSON es null después de parsear');
      }
    } else {
      console.log('La ruta no tiene campo geoJSON');
    }
    
    // Obtener paradas asociadas
    const stops = await db.select().from(busStops).where(eq(busStops.routeId, routeId));
    
    console.log('\n=== Información de paradas ===');
    console.log(`Número de paradas encontradas: ${stops.length}`);
    
    if (stops.length > 0) {
      console.log('\nPrimeras 3 paradas:');
      stops.slice(0, 3).forEach((stop, index) => {
        console.log(`\nParada ${index + 1}:`);
        console.log(`ID: ${stop.id}`);
        console.log(`Nombre: ${stop.name}`);
        console.log(`Coordenadas: ${stop.latitude}, ${stop.longitude}`);
        
        if (stop.location) {
          const location = typeof stop.location === 'string'
            ? JSON.parse(stop.location)
            : stop.location;
          
          console.log('Ubicación GeoJSON:');
          console.log(JSON.stringify(location, null, 2));
        }
      });
    }
  } catch (error) {
    console.error('Error al inspeccionar la ruta:', error);
  } finally {
    await pool.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const routeId = parseInt(args[0] || '702', 10);
  
  if (isNaN(routeId)) {
    console.error('Por favor proporciona un ID de ruta válido');
    process.exit(1);
  }
  
  await inspectRoute(routeId);
}

main();