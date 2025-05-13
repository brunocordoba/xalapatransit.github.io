import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import * as fs from 'fs';
import * as path from 'path';

// Configura WebSocket para Neon
neonConfig.webSocketConstructor = ws;

// Configura conexión a la base de datos
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Ruta a la carpeta con los archivos corregidos
const CORRECTED_DIR = path.resolve('./tmp/corregidos/Corregidos');

// Asignar colores a las rutas según zona y ID
function getRouteColor(routeId: number, zone: string): string {
  // Colores base por zona
  const zoneColors: Record<string, string> = {
    'Norte': '#FFDD00', // Amarillo
    'Sur': '#00AAFF',   // Azul claro
    'Este': '#FF5500',  // Naranja
    'Oeste': '#AA00FF', // Púrpura
    'Centro': '#00CC66' // Verde
  };
  
  // Usar color de zona
  return zoneColors[zone] || '#FFDD00';
}

// Determinar zona según el ID de la ruta
function determineZone(routeId: number): string {
  if (routeId >= 1 && routeId <= 25) return 'Norte';
  if (routeId >= 26 && routeId <= 50) return 'Sur';
  if (routeId >= 51 && routeId <= 75) return 'Este';
  if (routeId >= 76 && routeId <= 100) return 'Oeste';
  return 'Centro';
}

// Aproximar tiempo de ruta basado en número de puntos
function approximateTimeFromPoints(points: number): string {
  // Estimación basada en la complejidad de la ruta
  const minutes = Math.max(20, Math.min(120, Math.floor(points / 10) * 5));
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${remainingMinutes}min`;
  }
  
  return `${minutes} min`;
}

// Generar frecuencia aleatoria para la ruta
function getRandomFrequency(): string {
  const options = [
    '5-10 min',
    '10-15 min',
    '15-20 min',
    '20-30 min'
  ];
  
  return options[Math.floor(Math.random() * options.length)];
}

// Importar una ruta simple con coordenadas de ejemplo para verificación
async function importSimpleRoute(routeId: number): Promise<void> {
  try {
    console.log(`Importando ruta simple ${routeId}...`);
    
    const zone = determineZone(routeId);
    const routeName = `Ruta ${routeId}`;
    const shortName = `R${routeId}`;
    
    // Generar coordenadas simples (diagonal a través de Xalapa)
    const centerLat = 19.5438;
    const centerLng = -96.9270;
    
    // Generar coordenadas en forma de diagonal
    const coordinates: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const offset = i * 0.005;
      coordinates.push([centerLng - offset, centerLat - offset]);
    }
    
    // Crear GeoJSON estándar
    const geoJson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            id: routeId,
            name: routeName
          },
          geometry: {
            type: "LineString",
            coordinates: coordinates
          }
        }
      ]
    };
    
    // Insertar la ruta
    const insertRouteResult = await pool.query(`
      INSERT INTO bus_routes (
        id, name, short_name, color, frequency, schedule_start, schedule_end,
        stops_count, approximate_time, zone, popular, geo_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        short_name = EXCLUDED.short_name,
        color = EXCLUDED.color,
        frequency = EXCLUDED.frequency,
        schedule_start = EXCLUDED.schedule_start,
        schedule_end = EXCLUDED.schedule_end,
        stops_count = EXCLUDED.stops_count,
        approximate_time = EXCLUDED.approximate_time,
        zone = EXCLUDED.zone,
        popular = EXCLUDED.popular,
        geo_json = EXCLUDED.geo_json
      RETURNING id
    `, [
      routeId,
      routeName,
      shortName,
      getRouteColor(routeId, zone),
      getRandomFrequency(),
      '05:00',
      '23:00',
      0,
      approximateTimeFromPoints(coordinates.length),
      zone,
      false,
      JSON.stringify(geoJson)
    ]);
    
    if (insertRouteResult.rowCount === 0) {
      console.error(`Error al insertar la ruta ${routeId}`);
      return;
    }
    
    console.log(`✅ Ruta creada: ${routeName} (ID: ${routeId}) con ${coordinates.length} puntos`);
    
    // Crear algunas paradas a lo largo de la ruta
    for (let i = 0; i < 5; i++) {
      const stopIndex = Math.floor(i * (coordinates.length - 1) / 4);
      const stopCoords = coordinates[stopIndex];
      const stopName = `Parada ${i+1} (Ruta ${routeId})`;
      const isTerminal = i === 0 || i === 4;
      const terminalType = i === 0 ? 'origin' : i === 4 ? 'destination' : '';
      
      // Crear objeto location con formato correcto para JSONB
      const location = {
        type: 'Point',
        coordinates: stopCoords
      };
      
      await pool.query(`
        INSERT INTO bus_stops (
          route_id, name, latitude, longitude, is_terminal, terminal_type, location, "order"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        routeId,
        stopName,
        stopCoords[1].toString(), // latitude
        stopCoords[0].toString(), // longitude
        isTerminal,
        terminalType,
        JSON.stringify(location),
        i + 1 // orden secuencial
      ]);
    }
    
    // Actualizar el contador de paradas en la ruta
    await pool.query(`
      UPDATE bus_routes SET stops_count = $1 WHERE id = $2
    `, [5, routeId]);
    
    console.log(`✅ 5 paradas creadas para la ruta ${routeId}`);
    console.log(`Importación de ruta ${routeId} completada.`);
  } catch (error) {
    console.error(`Error al importar ruta ${routeId}:`, error);
  }
}

// Importar varias rutas simples
async function importSimpleRoutes() {
  try {
    console.log('Iniciando importación de rutas simples...');
    
    for (let i = 1; i <= 5; i++) {
      await importSimpleRoute(i);
    }
    
    console.log('Importación de rutas completada.');
  } catch (error) {
    console.error('Error al importar rutas:', error);
  } finally {
    await pool.end();
  }
}

// Ejecutar la importación
importSimpleRoutes();