import { db } from '../server/db';

async function createBusRouteStopsTable() {
  console.log('Creando tabla bus_route_stops...');
  
  try {
    // Verificar si la tabla ya existe
    const tableExists = await db.execute(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'bus_route_stops'
      );
    `);
    
    const exists = tableExists.rows[0]?.exists === true;
    
    if (exists) {
      console.log('La tabla bus_route_stops ya existe.');
      return;
    }
    
    // Crear la tabla
    await db.execute(`
      CREATE TABLE bus_route_stops (
        id SERIAL PRIMARY KEY,
        route_id INTEGER NOT NULL REFERENCES bus_routes(id),
        name TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        geo_json JSONB NOT NULL
      );
    `);
    
    console.log('Tabla bus_route_stops creada correctamente.');
    
  } catch (error) {
    console.error('Error al crear la tabla bus_route_stops:', error);
  }
}

// Ejecutar la función
createBusRouteStopsTable().catch(console.error);