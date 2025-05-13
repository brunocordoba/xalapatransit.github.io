import fs from 'fs';
import path from 'path';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Número máximo de rutas a importar (0 para todas)
const MAX_ROUTES = 10; 

// Colores para las rutas basados en zonas
const ROUTE_COLOR_MAP: Record<string, string> = {
  'Norte': '#f44336', // Rojo
  'Sur': '#2196f3',   // Azul
  'Centro': '#ffeb3b', // Amarillo
  'Este': '#4caf50',  // Verde
  'Oeste': '#9c27b0'  // Morado
};

function getRouteColor(routeId: number, zone: string): string {
  return ROUTE_COLOR_MAP[zone] || '#ff9800'; // Naranja por defecto
}

function determineZone(routeId: number): string {
  // Determinar zona basada en el ID de ruta
  if (routeId >= 1 && routeId <= 20) {
    return 'Norte';
  } else if (routeId >= 21 && routeId <= 40) {
    return 'Sur';
  } else if (routeId >= 41 && routeId <= 60) {
    return 'Centro';
  } else if (routeId >= 61 && routeId <= 80) {
    return 'Este';
  } else if (routeId >= 81 && routeId <= 120) {
    return 'Oeste';
  }
  return 'Centro'; // Valor por defecto
}

function approximateTimeFromPoints(points: number): string {
  // Calcular tiempo aproximado basado en la cantidad de puntos
  // Asumiendo que cada punto toma entre 1-2 minutos
  const minutes = Math.max(10, Math.min(120, Math.floor(points * 1.5)));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${mins}min`;
  }
  return `${mins} min`;
}

function getFrequencyByZone(zone: string): string {
  // Frecuencias por zona
  const frequencies: Record<string, string> = {
    'Norte': '10-15 min',
    'Sur': '15-20 min',
    'Centro': '5-10 min',
    'Este': '10-15 min',
    'Oeste': '15-20 min'
  };
  
  return frequencies[zone] || '10-15 min';
}

type RouteType = 'direct' | 'ida' | 'vuelta';

// Función principal para importar todas las rutas
async function importAllRoutes() {
  // Limpiar base de datos primero
  console.log('Limpiando base de datos...');
  await db.delete(busStops);
  await db.delete(busRoutes);
  
  // Directorio donde están los archivos
  const baseDir = './tmp/corregidos/Corregidos';
  const files = fs.readdirSync(baseDir);
  
  // Extraer información de las rutas
  const routes: Map<number, { 
    routeId: number, 
    name: string,
    files: { 
      type: RouteType, 
      routeFile: string, 
      stopsFile?: string 
    }[]
  }> = new Map();
  
  // Primera pasada: agrupar archivos por ID de ruta
  for (const file of files) {
    if (!file.endsWith('.geojson')) continue;
    
    // Extraer ID de ruta y tipo (route o stops)
    let match: RegExpMatchArray | null;
    
    if ((match = file.match(/^(\d+)_route\.geojson$/))) {
      // Ruta directa: 001_route.geojson
      const routeId = parseInt(match[1]);
      const stopsFile = `${match[1]}_stops.geojson`;
      const stopsFilePath = path.join(baseDir, stopsFile);
      
      if (!routes.has(routeId)) {
        routes.set(routeId, { 
          routeId, 
          name: `Ruta ${routeId}`,
          files: []
        });
      }
      
      routes.get(routeId)!.files.push({
        type: 'direct',
        routeFile: file,
        stopsFile: fs.existsSync(stopsFilePath) ? stopsFile : undefined
      });
    } 
    else if ((match = file.match(/^(\d+)_ida_route\.geojson$/))) {
      // Ruta con ida: 003_ida_route.geojson
      const routeId = parseInt(match[1]);
      const stopsFile = `${match[1]}_ida_stops.geojson`;
      const stopsFilePath = path.join(baseDir, stopsFile);
      
      if (!routes.has(routeId)) {
        routes.set(routeId, { 
          routeId, 
          name: `Ruta ${routeId}`,
          files: []
        });
      }
      
      routes.get(routeId)!.files.push({
        type: 'ida',
        routeFile: file,
        stopsFile: fs.existsSync(stopsFilePath) ? stopsFile : undefined
      });
    }
    else if ((match = file.match(/^(\d+)_vuelta_route\.geojson$/))) {
      // Ruta con vuelta: 003_vuelta_route.geojson
      const routeId = parseInt(match[1]);
      const stopsFile = `${match[1]}_vuelta_stops.geojson`;
      const stopsFilePath = path.join(baseDir, stopsFile);
      
      if (!routes.has(routeId)) {
        routes.set(routeId, { 
          routeId, 
          name: `Ruta ${routeId}`,
          files: []
        });
      }
      
      routes.get(routeId)!.files.push({
        type: 'vuelta',
        routeFile: file,
        stopsFile: fs.existsSync(stopsFilePath) ? stopsFile : undefined
      });
    }
  }
  
  // Segunda pasada: procesar cada ruta
  let totalRoutes = routes.size;
  let message = MAX_ROUTES > 0 
    ? `Encontradas ${totalRoutes} rutas. Importando las primeras ${MAX_ROUTES}.` 
    : `Encontradas ${totalRoutes} rutas. Importando todas.`;
  
  console.log(message);
  
  // Convertir a array para poder limitar y ordenar
  const routesArray = Array.from(routes.entries());
  
  // Ordenar por ID de ruta
  routesArray.sort((a, b) => a[0] - b[0]);
  
  // Limitar al máximo especificado si es necesario
  const limitedRoutes = MAX_ROUTES > 0 ? routesArray.slice(0, MAX_ROUTES) : routesArray;
  
  let importedRoutes = 0;
  let importedStops = 0;
  
  for (const [routeId, routeInfo] of limitedRoutes) {
    console.log(`Procesando ruta ${routeId}...`);
    
    for (const fileInfo of routeInfo.files) {
      // Determinar el nombre de la ruta basado en el tipo
      let routeName = `Ruta ${routeId}`;
      if (fileInfo.type === 'ida') {
        routeName = `Ruta ${routeId} (Ida)`;
      } else if (fileInfo.type === 'vuelta') {
        routeName = `Ruta ${routeId} (Vuelta)`;
      }
      
      // Crear ID de ruta único
      let uniqueRouteId = routeId;
      if (fileInfo.type === 'ida') {
        uniqueRouteId = routeId * 1000 + 1; // Ejemplo: 3001 para ruta 3 ida
      } else if (fileInfo.type === 'vuelta') {
        uniqueRouteId = routeId * 1000 + 2; // Ejemplo: 3002 para ruta 3 vuelta
      }
      
      // Importar ruta y paradas
      try {
        const result = await importRouteWithStops(
          uniqueRouteId,
          routeName,
          path.join(baseDir, fileInfo.routeFile),
          fileInfo.stopsFile ? path.join(baseDir, fileInfo.stopsFile) : undefined
        );
        
        console.log(`Importada ruta ${uniqueRouteId} (${routeName}) con ${result.stopsCount || 0} paradas`);
        importedRoutes++;
        importedStops += result.stopsCount || 0;
      } catch (error) {
        console.error(`Error al importar ruta ${routeId} (${fileInfo.type}):`, error);
      }
    }
  }
  
  console.log(`Importación completada. Total: ${importedRoutes} rutas, ${importedStops} paradas.`);
}

// Función para importar una ruta y sus paradas
async function importRouteWithStops(
  routeId: number, 
  routeName: string,
  routeGeojsonPath: string, 
  stopsGeojsonPath?: string
): Promise<{ stopsCount: number }> {
  // Leer archivo GeoJSON de ruta
  const routeGeojson = JSON.parse(fs.readFileSync(routeGeojsonPath, 'utf8'));
  
  if (!routeGeojson.features || routeGeojson.features.length === 0) {
    throw new Error(`Archivo GeoJSON de ruta inválido: ${routeGeojsonPath}`);
  }
  
  // Extraer propiedades y coordenadas
  const routeFeature = routeGeojson.features[0];
  const routeProperties = routeFeature.properties || {};
  const routeGeometry = routeFeature.geometry;
  
  let coordinates: number[][] = [];
  
  if (routeGeometry.type === 'LineString') {
    coordinates = routeGeometry.coordinates;
  } 
  else if (routeGeometry.type === 'MultiLineString' && Array.isArray(routeGeometry.coordinates)) {
    // Para MultiLineString, concatenamos todos los segmentos de línea
    coordinates = routeGeometry.coordinates.flat();
  }
  else {
    throw new Error(`Geometría no soportada: ${routeGeometry.type}`);
  }
  
  // Generar datos de la ruta
  const zone = determineZone(routeId);
  const color = getRouteColor(routeId, zone);
  const approximateTime = approximateTimeFromPoints(coordinates.length);
  const frequency = getFrequencyByZone(zone);
  
  // Crear ruta en la base de datos
  await db.insert(busRoutes).values({
    id: routeId,
    name: routeName,
    shortName: `R${routeId}`,
    color: color,
    frequency: frequency,
    scheduleStart: '05:30',
    scheduleEnd: '22:00',
    stopsCount: 0, // Se actualizará después
    approximateTime: approximateTime,
    zone: zone,
    popular: false,
    // Guardar el GeoJSON completo
    geoJSON: routeGeojson
  });
  
  // Importar paradas si están disponibles
  let stopsCount = 0;
  if (stopsGeojsonPath) {
    try {
      const stopsGeojson = JSON.parse(fs.readFileSync(stopsGeojsonPath, 'utf8'));
      
      if (stopsGeojson.features && stopsGeojson.features.length > 0) {
        // Crear paradas
        for (let i = 0; i < stopsGeojson.features.length; i++) {
          const stopFeature = stopsGeojson.features[i];
          const stopProperties = stopFeature.properties || {};
          const stopGeometry = stopFeature.geometry;
          
          if (stopGeometry.type !== 'Point') {
            console.warn(`Geometría de parada no soportada: ${stopGeometry.type}`);
            continue;
          }
          
          const coordinates = stopGeometry.coordinates;
          
          await db.insert(busStops).values({
            routeId: routeId,
            name: `Parada ${i + 1}`,
            latitude: coordinates[1].toString(),
            longitude: coordinates[0].toString(),
            order: i
          });
          
          stopsCount++;
        }
      }
    } catch (error) {
      console.error(`Error al importar paradas para ruta ${routeId}:`, error);
    }
  }
  
  // Actualizar contador de paradas en la ruta
  await db.update(busRoutes)
    .set({ stopsCount })
    .where(eq(busRoutes.id, routeId));
  
  return { stopsCount };
}

// Ejecutar la función principal
importAllRoutes()
  .then(() => {
    console.log('Importación finalizada con éxito');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en la importación:', error);
    process.exit(1);
  });