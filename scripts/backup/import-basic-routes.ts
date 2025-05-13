import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Configura WebSocket para Neon
neonConfig.webSocketConstructor = ws;

// Configura conexión a la base de datos
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Función para crear rutas de prueba básicas
async function createBasicRoutes() {
  try {
    console.log('Limpiando datos existentes...');
    await pool.query('DELETE FROM bus_stops');
    await pool.query('DELETE FROM bus_routes');
    
    console.log('Creando rutas básicas...');
    
    // Crear 5 rutas básicas
    for (let i = 1; i <= 5; i++) {
      // Determinar zona basada en ID
      const zone = getZoneForRoute(i);
      
      // Valores comunes
      const routeName = `Ruta ${i}`;
      const shortName = `R${i}`;
      const color = getColorForZone(zone);
      const frequency = getRandomFrequency();
      
      // Crear ruta en centro de Xalapa
      const baseLatitude = 19.5438;  // Centro de Xalapa
      const baseLongitude = -96.9270;
      
      // Generar puntos espaciados por +/- 0.005 grados (~500m)
      // Cada ruta tendrá forma diferente
      const coordinates = generateRouteShape(i, baseLatitude, baseLongitude);
      
      // Crear objeto GeoJSON simple
      const geoJson = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              id: i,
              name: routeName
            },
            geometry: {
              type: "LineString",
              coordinates: coordinates
            }
          }
        ]
      };
      
      // Insertar ruta en la base de datos
      const result = await pool.query(`
        INSERT INTO bus_routes (
          id, name, short_name, color, frequency, schedule_start, schedule_end,
          stops_count, approximate_time, zone, popular, geo_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `, [
        i,                        // id
        routeName,                // name
        shortName,                // short_name
        color,                    // color
        frequency,                // frequency
        '05:00',                  // schedule_start
        '23:00',                  // schedule_end
        5,                        // stops_count (por defecto)
        calculateTimeFromPoints(coordinates.length),  // approximate_time
        zone,                     // zone
        i <= 3,                   // popular (rutas 1-3 son populares)
        JSON.stringify(geoJson)   // geo_json
      ]);
      
      console.log(`Ruta ${i} creada con ID: ${result.rows[0].id}`);
      
      // Crear 5 paradas para cada ruta
      await createStopsForRoute(i, coordinates);
    }
    
    console.log('Proceso completado con éxito');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

// Función para crear paradas de autobús
async function createStopsForRoute(routeId: number, coordinates: [number, number][]) {
  try {
    // Crear paradas equidistantes a lo largo de la ruta
    const totalPoints = coordinates.length;
    const numStops = 5;
    
    for (let i = 0; i < numStops; i++) {
      // Calcular posición relativa en la ruta (0 al inicio, totalPoints-1 al final)
      const index = Math.floor(i * (totalPoints - 1) / (numStops - 1));
      const coord = coordinates[index];
      
      // Determinar si es una parada terminal
      const isTerminal = i === 0 || i === numStops - 1;
      const terminalType = i === 0 ? 'origin' : (i === numStops - 1 ? 'destination' : null);
      
      // Crear objeto location con formato correcto para JSONB
      const location = {
        type: 'Point',
        coordinates: coord
      };
      
      // Insertar parada
      await pool.query(`
        INSERT INTO bus_stops (
          route_id, name, latitude, longitude, is_terminal, terminal_type, location, "order"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        routeId,
        `Parada ${i+1} (Ruta ${routeId})`,
        coord[1].toString(),      // latitude
        coord[0].toString(),      // longitude
        isTerminal,               // is_terminal
        terminalType,             // terminal_type
        JSON.stringify(location), // location como JSONB
        i + 1                     // order secuencial
      ]);
    }
    
    console.log(`Creadas 5 paradas para la ruta ${routeId}`);
  } catch (error) {
    console.error(`Error al crear paradas para ruta ${routeId}:`, error);
  }
}

// Función para generar diferentes formas de ruta según ID
function generateRouteShape(routeId: number, baseLatitude: number, baseLongitude: number): [number, number][] {
  const coordinates: [number, number][] = [];
  const pointsCount = 10 + routeId * 2; // Más puntos para rutas con ID mayor
  
  switch (routeId) {
    case 1: // Ruta horizontal (este-oeste)
      for (let i = 0; i < pointsCount; i++) {
        coordinates.push([
          baseLongitude - 0.005 + (0.01 * i / (pointsCount - 1)),
          baseLatitude
        ]);
      }
      break;
      
    case 2: // Ruta vertical (norte-sur)
      for (let i = 0; i < pointsCount; i++) {
        coordinates.push([
          baseLongitude,
          baseLatitude - 0.005 + (0.01 * i / (pointsCount - 1))
        ]);
      }
      break;
      
    case 3: // Ruta diagonal (noroeste-sureste)
      for (let i = 0; i < pointsCount; i++) {
        coordinates.push([
          baseLongitude - 0.005 + (0.01 * i / (pointsCount - 1)),
          baseLatitude - 0.005 + (0.01 * i / (pointsCount - 1))
        ]);
      }
      break;
      
    case 4: // Ruta circular
      for (let i = 0; i < pointsCount; i++) {
        const angle = (i / pointsCount) * 2 * Math.PI;
        coordinates.push([
          baseLongitude + 0.005 * Math.cos(angle),
          baseLatitude + 0.005 * Math.sin(angle)
        ]);
      }
      break;
      
    case 5: // Ruta en zigzag
      for (let i = 0; i < pointsCount; i++) {
        coordinates.push([
          baseLongitude - 0.005 + (0.01 * i / (pointsCount - 1)),
          baseLatitude + (i % 2 === 0 ? 0.002 : -0.002)
        ]);
      }
      break;
      
    default: // Ruta por defecto (diagonal)
      for (let i = 0; i < pointsCount; i++) {
        coordinates.push([
          baseLongitude - 0.005 + (0.01 * i / (pointsCount - 1)),
          baseLatitude - 0.005 + (0.01 * i / (pointsCount - 1))
        ]);
      }
  }
  
  return coordinates;
}

// Función para determinar la zona según ID de ruta
function getZoneForRoute(routeId: number): string {
  if (routeId >= 1 && routeId <= 25) return 'Norte';
  if (routeId >= 26 && routeId <= 50) return 'Sur';
  if (routeId >= 51 && routeId <= 75) return 'Este';
  if (routeId >= 76 && routeId <= 100) return 'Oeste';
  return 'Centro';
}

// Función para obtener color según zona
function getColorForZone(zone: string): string {
  const zoneColors: Record<string, string> = {
    'Norte': '#FFDD00', // Amarillo
    'Sur': '#00AAFF',   // Azul claro
    'Este': '#FF5500',  // Naranja
    'Oeste': '#AA00FF', // Púrpura
    'Centro': '#00CC66' // Verde
  };
  
  return zoneColors[zone] || '#FFDD00';
}

// Función para calcular tiempo aproximado según cantidad de puntos
function calculateTimeFromPoints(points: number): string {
  const minutes = Math.max(20, Math.min(120, Math.floor(points / 2) * 5));
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${remainingMinutes}min`;
  }
  
  return `${minutes} min`;
}

// Función para generar frecuencia aleatoria
function getRandomFrequency(): string {
  const frequencies = [
    '5-10 min',
    '10-15 min',
    '15-20 min',
    '20-30 min'
  ];
  
  return frequencies[Math.floor(Math.random() * frequencies.length)];
}

// Ejecutar la función principal
createBasicRoutes();