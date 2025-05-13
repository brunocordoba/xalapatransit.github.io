import fs from 'fs';
import path from 'path';
import { db } from '../server/db';
import { busRoutes, busStops } from '@shared/schema';
import { eq } from 'drizzle-orm';

const ROUTE_COLOR_MAP: Record<string, string> = {
  'Norte': '#E74C3C', // Rojo
  'Sur': '#3498DB',   // Azul
  'Centro': '#F1C40F', // Amarillo
  'Este': '#2ECC71',  // Verde
  'Oeste': '#9B59B6'  // Morado
};

function getRandomColor(): string {
  const colors = Object.values(ROUTE_COLOR_MAP);
  return colors[Math.floor(Math.random() * colors.length)];
}

function getRouteColor(routeId: number, zone: string): string {
  // Asignar color según la zona si está disponible, si no usar uno aleatorio
  if (ROUTE_COLOR_MAP[zone]) {
    return ROUTE_COLOR_MAP[zone];
  }
  return getRandomColor();
}

function determineZone(routeId: number, description?: string): string {
  // Determinar zona basada en el ID de ruta o la descripción
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

  // Si hay descripción, intentar determinar zona por palabras clave
  if (description) {
    const desc = description.toLowerCase();
    if (desc.includes('norte') || desc.includes('camacho') || desc.includes('bugambilias')) {
      return 'Norte';
    } else if (desc.includes('sur') || desc.includes('arco')) {
      return 'Sur';
    } else if (desc.includes('centro') || desc.includes('catedral')) {
      return 'Centro';
    } else if (desc.includes('este') || desc.includes('lazaro')) {
      return 'Este';
    } else if (desc.includes('oeste') || desc.includes('animas')) {
      return 'Oeste';
    }
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

function getRandomFrequency(): string {
  // Generar frecuencia aleatoria entre 5-25 minutos
  const frequencies = ['5-10 min', '10-15 min', '15-20 min', '20-25 min'];
  return frequencies[Math.floor(Math.random() * frequencies.length)];
}

type RouteType = 'direct' | 'ida' | 'vuelta';

// Función principal para importar todas las rutas corregidas
async function importAllCorrectedRoutes() {
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
    
    // Patrones para diferentes formatos de archivo
    // 1. Ruta directa: 001_route.geojson y 001_stops.geojson
    // 2. Ruta con ida/vuelta: 003_ida_route.geojson y 003_ida_stops.geojson
    
    if ((match = file.match(/^(\d+)_route\.geojson$/))) {
      // Caso simple: 001_route.geojson
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
      // Caso con ida: 003_ida_route.geojson
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
      // Caso con vuelta: 003_vuelta_route.geojson
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
    // Ignorar archivos de paradas - se manejan junto con las rutas
  }
  
  console.log(`Encontradas ${routes.size} rutas para importar`);
  
  // Segunda pasada: procesar cada ruta
  let importedRoutes = 0;
  let importedStops = 0;
  
  for (const [routeId, routeInfo] of routes.entries()) {
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

// Función para importar una ruta y sus paradas desde archivos GeoJSON
async function importRouteWithStops(
  routeId: number, 
  routeName: string,
  routeGeojsonPath: string, 
  stopsGeojsonPath?: string
): Promise<{ stopsCount?: number }> {
  // Leer archivo GeoJSON de ruta
  const routeGeojson = JSON.parse(fs.readFileSync(routeGeojsonPath, 'utf8'));
  
  if (!routeGeojson.features || routeGeojson.features.length === 0) {
    throw new Error(`Archivo GeoJSON de ruta inválido: ${routeGeojsonPath}`);
  }
  
  // Extraer propiedades y coordenadas
  const routeFeature = routeGeojson.features[0];
  const routeProperties = routeFeature.properties || {};
  const routeGeometry = routeFeature.geometry;
  
  if (routeGeometry.type !== 'LineString') {
    throw new Error(`Geometría no soportada: ${routeGeometry.type}`);
  }
  
  const coordinates = routeGeometry.coordinates;
  
  // Generar datos de la ruta
  const zone = determineZone(routeId, routeProperties.desc);
  const color = getRouteColor(routeId, zone);
  const approximateTime = approximateTimeFromPoints(coordinates.length);
  const frequency = getRandomFrequency();
  
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
          const stopId = routeId * 10000 + i + 1; // Generar ID único para la parada
          
          await db.insert(busStops).values({
            id: stopId,
            routeId: routeId,
            name: `Parada ${i + 1}`,
            latitude: coordinates[1],
            longitude: coordinates[0],
            sequence: i,
            popular: false
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
importAllCorrectedRoutes()
  .then(() => {
    console.log('Importación finalizada con éxito');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en la importación:', error);
    process.exit(1);
  });