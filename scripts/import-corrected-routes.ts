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
  
  // Usar color de zona con una variación basada en ID para distinguir rutas de la misma zona
  const baseColor = zoneColors[zone] || '#FFDD00';
  
  return baseColor;
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

// Importar una ruta y sus paradas
async function importRouteWithStops(
  routeId: number, 
  routeType: 'direct' | 'ida' | 'vuelta', 
  routeFilePath: string, 
  stopsFilePath?: string
): Promise<void> {
  try {
    console.log(`Importando ruta ${routeId}${routeType !== 'direct' ? ' (' + routeType + ')' : ''}...`);
    
    // Leer archivo de ruta
    if (!fs.existsSync(routeFilePath)) {
      console.error(`Archivo de ruta no encontrado: ${routeFilePath}`);
      return;
    }
    
    const routeData = JSON.parse(fs.readFileSync(routeFilePath, 'utf8'));
    
    // Verificar estructura del GeoJSON de ruta
    if (!routeData) {
      console.error(`Formato GeoJSON inválido para la ruta ${routeId} - No hay datos`);
      return;
    }
    
    // Extraer coordenadas
    let coordinates: [number, number][] = [];
    
    if (routeData.features && routeData.features[0] && routeData.features[0].geometry) {
      // Formato FeatureCollection
      const routeFeature = routeData.features[0];
      if (routeFeature.geometry.coordinates) {
        coordinates = routeFeature.geometry.coordinates;
      }
    } else if (routeData.geometry && routeData.geometry.coordinates) {
      // Formato Feature directo
      coordinates = routeData.geometry.coordinates;
    } else if (routeData.coordinates) {
      // Objeto con coordenadas directas
      coordinates = routeData.coordinates;
    } else if (Array.isArray(routeData)) {
      // Array directo de coordenadas
      coordinates = routeData;
    }
    
    // Asegurar que hay coordenadas
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      // Si no hay suficientes coordenadas, crear al menos dos puntos para que la ruta se pueda mostrar
      console.warn(`La ruta ${routeId} no tiene suficientes coordenadas. Creando coordenadas mínimas para visualización.`);
      
      // Usar coordenadas del centro de Xalapa como fallback
      const centroXalapa: [number, number] = [-96.9270, 19.5438];
      coordinates = [
        [centroXalapa[0] - 0.005, centroXalapa[1] - 0.005], // Punto al suroeste del centro
        [centroXalapa[0] + 0.005, centroXalapa[1] + 0.005]  // Punto al noreste del centro
      ];
    }
    
    // Determinar nombre de la ruta
    const zone = determineZone(routeId);
    const routeName = `Ruta ${routeId}${routeType !== 'direct' ? ' (' + routeType + ')' : ''}`;
    const shortName = `R${routeId}${routeType === 'ida' ? 'I' : routeType === 'vuelta' ? 'V' : ''}`;
    
    // Construir ID apropiado para el tipo de ruta
    let idRuta;
    if (routeType === 'direct') {
      idRuta = routeId;
    } else if (routeType === 'ida') {
      // Para ida usamos el formato XXYYY donde XX es el ID de la ruta y YYY es 001
      idRuta = routeId * 1000 + 1;
    } else {
      // Para vuelta usamos el formato XXYYY donde XX es el ID de la ruta y YYY es 002
      idRuta = routeId * 1000 + 2;
    }
    
    // Preparar datos para la inserción
    const routeInsertData = {
      id: idRuta,
      name: routeName,
      shortName: shortName,
      color: getRouteColor(routeId, zone),
      frequency: getRandomFrequency(),
      scheduleStart: '05:00',
      scheduleEnd: '23:00',
      stopsCount: 0, // Se actualizará después
      approximateTime: approximateTimeFromPoints(coordinates.length),
      zone: zone,
      popular: false,
      geoJSON: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              id: idRuta,
              name: routeName,
              shortName: shortName,
              color: getRouteColor(routeId, zone)
            },
            geometry: {
              type: "LineString",
              coordinates: coordinates
            }
          }
        ]
      }
    };
    
    // Insertar la ruta
    const insertRouteResult = await pool.query(`
      INSERT INTO bus_routes (
        id, name, short_name, color, frequency, schedule_start, schedule_end,
        stops_count, approximate_time, zone, popular, geo_json
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
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
      routeInsertData.id,
      routeInsertData.name,
      routeInsertData.shortName,
      routeInsertData.color,
      routeInsertData.frequency,
      routeInsertData.scheduleStart,
      routeInsertData.scheduleEnd,
      routeInsertData.stopsCount,
      routeInsertData.approximateTime,
      routeInsertData.zone,
      routeInsertData.popular,
      JSON.stringify(routeInsertData.geoJSON)
    ]);
    
    if (insertRouteResult.rowCount === 0) {
      console.error(`Error al insertar la ruta ${routeId}`);
      return;
    }
    
    console.log(`✅ Ruta creada: ${routeName} (ID: ${routeInsertData.id}) con ${coordinates.length} puntos`);
    
    // Procesar paradas si existe el archivo
    let stopsCount = 0;
    if (stopsFilePath && fs.existsSync(stopsFilePath)) {
      const stopsData = JSON.parse(fs.readFileSync(stopsFilePath, 'utf8'));
      
      // Verificar estructura del GeoJSON de paradas
      if (!stopsData || !stopsData.features) {
        console.warn(`Formato GeoJSON inválido para las paradas de la ruta ${routeId}`);
      } else {
        const validStops = stopsData.features.filter((feature: any) => 
          feature && feature.geometry && feature.geometry.type === 'Point' && 
          Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length >= 2
        );
        
        console.log(`Procesando ${validStops.length} paradas para la ruta ${routeId}...`);
        
        // Insertar paradas por lotes para mejor rendimiento
        for (let i = 0; i < validStops.length; i++) {
          const stop = validStops[i];
          const stopCoords = stop.geometry.coordinates;
          const stopName = stop.properties?.name || `Parada ${i+1} (Ruta ${routeId})`;
          const isTerminal = i === 0 || i === validStops.length - 1;
          const terminalType = i === 0 ? 'origin' : i === validStops.length - 1 ? 'destination' : '';
          
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
            routeInsertData.id,
            stopName,
            stopCoords[1].toString(), // latitude
            stopCoords[0].toString(), // longitude
            isTerminal,
            terminalType,
            JSON.stringify(location),
            i + 1 // orden secuencial
          ]);
          
          stopsCount++;
        }
        
        // Actualizar el contador de paradas en la ruta
        if (stopsCount > 0) {
          await pool.query(`
            UPDATE bus_routes SET stops_count = $1 WHERE id = $2
          `, [stopsCount, routeInsertData.id]);
        }
        
        console.log(`✅ ${stopsCount} paradas importadas para la ruta ${routeId}`);
      }
    } else {
      console.warn(`No se encontró archivo de paradas para la ruta ${routeId}`);
    }
    
    console.log(`Importación de ruta ${routeId} completada.`);
  } catch (error) {
    console.error(`Error al importar ruta ${routeId}:`, error);
  }
}

// Importar todas las rutas corregidas
async function importAllCorrectedRoutes() {
  try {
    console.log('Iniciando importación de rutas corregidas...');
    
    // Listar todos los archivos en la carpeta
    const files = fs.readdirSync(CORRECTED_DIR);
    
    // Agrupar los archivos por ruta (ID y tipo)
    const routeMap = new Map<string, {
      id: number;
      type: 'direct' | 'ida' | 'vuelta';
      routeFile: string;
      stopsFile?: string;
    }>();
    
    // Recorrer archivos y agruparlos
    for (const file of files) {
      if (!file.endsWith('.geojson')) continue;
      
      // Analizar nombre del archivo para extraer información
      let match;
      
      // Comprobar si es "ida" o "vuelta"
      if ((match = file.match(/^(\d+)_(ida|vuelta)_(route|stops|stop)\.geojson$/))) {
        const [, idStr, direction, fileType] = match;
        const id = parseInt(idStr);
        const key = `${id}_${direction}`;
        
        if (!routeMap.has(key)) {
          routeMap.set(key, {
            id,
            type: direction as 'ida' | 'vuelta',
            routeFile: '',
            stopsFile: ''
          });
        }
        
        const entry = routeMap.get(key)!;
        if (fileType === 'route') {
          entry.routeFile = path.join(CORRECTED_DIR, file);
        } else {
          entry.stopsFile = path.join(CORRECTED_DIR, file);
        }
      }
      // Comprobar si es "routes" o "stops" con ida/vuelta
      else if ((match = file.match(/^(\d+)_(routes|stops)_(ida|vuelta)\.geojson$/))) {
        const [, idStr, fileType, direction] = match;
        const id = parseInt(idStr);
        const key = `${id}_${direction}`;
        
        if (!routeMap.has(key)) {
          routeMap.set(key, {
            id,
            type: direction as 'ida' | 'vuelta',
            routeFile: '',
            stopsFile: ''
          });
        }
        
        const entry = routeMap.get(key)!;
        if (fileType === 'routes') {
          entry.routeFile = path.join(CORRECTED_DIR, file);
        } else {
          entry.stopsFile = path.join(CORRECTED_DIR, file);
        }
      }
      // Comprobar si es una ruta directa
      else if ((match = file.match(/^(\d+)_(route|stops|stop)s?\.geojson$/))) {
        const [, idStr, fileType] = match;
        const id = parseInt(idStr);
        const key = `${id}_direct`;
        
        if (!routeMap.has(key)) {
          routeMap.set(key, {
            id,
            type: 'direct',
            routeFile: '',
            stopsFile: ''
          });
        }
        
        const entry = routeMap.get(key)!;
        if (fileType === 'route') {
          entry.routeFile = path.join(CORRECTED_DIR, file);
        } else {
          entry.stopsFile = path.join(CORRECTED_DIR, file);
        }
      }
    }
    
    console.log(`Se encontraron ${routeMap.size} rutas para importar.`);
    
    // Importar cada ruta
    for (const [key, route] of routeMap.entries()) {
      if (!route.routeFile) {
        console.warn(`La ruta ${key} no tiene archivo de ruta, omitiendo.`);
        continue;
      }
      
      await importRouteWithStops(route.id, route.type, route.routeFile, route.stopsFile);
    }
    
    console.log('Importación de rutas completada.');
  } catch (error) {
    console.error('Error al importar rutas corregidas:', error);
  } finally {
    // Cerrar la conexión a la base de datos
    await pool.end();
  }
}

// Ejecutar la importación
importAllCorrectedRoutes();