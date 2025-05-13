import fs from 'fs';
import path from 'path';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Colores para rutas según ID
function getRandomColor(): string {
  const colors = [
    '#4285F4', // Google Blue
    '#EA4335', // Google Red
    '#FBBC05', // Google Yellow
    '#34A853', // Google Green
    '#FF5722', // Deep Orange
    '#9C27B0', // Purple
    '#3F51B5', // Indigo
    '#2196F3', // Blue
    '#03A9F4', // Light Blue
    '#00BCD4', // Cyan
    '#009688', // Teal
    '#4CAF50', // Green
    '#8BC34A', // Light Green
    '#CDDC39', // Lime
    '#FFEB3B', // Yellow
    '#FFC107', // Amber
    '#FF9800', // Orange
    '#FF5722', // Deep Orange
    '#795548', // Brown
  ];
  
  return colors[Math.floor(Math.random() * colors.length)];
}

// Asignar color basado en ID y zona
function getRouteColor(routeId: number, zone: string): string {
  // Colores por zona
  const zoneColors: Record<string, string> = {
    'Norte': '#f44336', // Rojo
    'Sur': '#2196f3',   // Azul
    'Centro': '#ffeb3b', // Amarillo
    'Este': '#4caf50',  // Verde
    'Oeste': '#9c27b0'  // Púrpura
  };
  
  // Usar el color de la zona, o un color aleatorio como respaldo
  return zoneColors[zone] || getRandomColor();
}

// Determinar zona basada en ID y descripción
function determineZone(routeId: number, description?: string): string {
  if (description && description.toLowerCase().includes('norte')) {
    return 'Norte';
  } else if (description && description.toLowerCase().includes('sur')) {
    return 'Sur';
  } else if (description && description.toLowerCase().includes('centro')) {
    return 'Centro';
  } else if (description && description.toLowerCase().includes('este')) {
    return 'Este';
  } else if (description && description.toLowerCase().includes('oeste')) {
    return 'Oeste';
  }
  
  // Si no hay descripción o no contiene referencia a una zona, asignar por ID
  if (routeId >= 1 && routeId <= 20) {
    return 'Norte';
  } else if (routeId >= 21 && routeId <= 50) {
    return 'Sur';
  } else if (routeId >= 51 && routeId <= 80) {
    return 'Este';
  } else if (routeId >= 81 && routeId <= 120) {
    return 'Oeste';
  }
  
  return 'Centro'; // Default
}

// Calcular tiempo aproximado basado en puntos
function approximateTimeFromPoints(points: number): string {
  // Estimar tiempo en base a los puntos (cada punto ≈ 10-20 segundos)
  const totalSeconds = points * 15;
  const minutes = Math.floor(totalSeconds / 60);
  
  // Limitar a un rango razonable (entre 10-120 minutos)
  const limitedMinutes = Math.max(10, Math.min(120, minutes));
  
  // Formatear respuesta
  if (limitedMinutes >= 60) {
    const hours = Math.floor(limitedMinutes / 60);
    const mins = limitedMinutes % 60;
    return `${hours}h ${mins}min`;
  }
  
  return `${limitedMinutes} min`;
}

// Generar frecuencia aleatoria
function getRandomFrequency(): string {
  const frequencies = [
    "5-10 min",
    "10-15 min", 
    "15-20 min",
    "20-30 min"
  ];
  
  return frequencies[Math.floor(Math.random() * frequencies.length)];
}

// Tipos de ruta
type RouteType = 'direct' | 'ida' | 'vuelta';

// Importar una ruta con sus paradas
async function importRouteWithStops(
  routeId: number,
  routeName: string,
  routeFilePath: string,
  stopsFilePath?: string
): Promise<{ stopsCount: number }> {
  let stopsCount = 0;
  
  try {
    // Leer archivo de ruta
    const routeData = JSON.parse(fs.readFileSync(routeFilePath, 'utf8'));
    if (!routeData.features || routeData.features.length === 0) {
      console.error(`Archivo de ruta no tiene características: ${routeFilePath}`);
      return { stopsCount: 0 };
    }
    
    // Extraer datos de la característica principal
    const feature = routeData.features[0];
    
    if (!feature.geometry) {
      console.error(`Geometría no encontrada en la ruta: ${routeFilePath}`);
      return { stopsCount: 0 };
    }
    
    const geometry = feature.geometry;
    
    // Extraer coordenadas según el tipo de geometría
    let coordinates: [number, number][] = [];
    if (geometry.type === 'LineString') {
      coordinates = geometry.coordinates;
      console.log(`Usando geometría LineString con ${coordinates.length} puntos para ruta ${routeId}`);
    } else if (geometry.type === 'MultiLineString') {
      // Para MultiLineString, concatenamos todos los segmentos
      coordinates = geometry.coordinates.flat();
      console.log(`Usando geometría MultiLineString con ${coordinates.length} puntos para ruta ${routeId}`);
    } else {
      console.error(`Tipo de geometría no soportado: ${geometry.type}`);
      return { stopsCount: 0 };
    }
    
    // Determinar zona y otros atributos
    const zone = determineZone(routeId, feature.properties?.description);
    const color = getRouteColor(routeId, zone);
    const approximateTime = approximateTimeFromPoints(coordinates.length);
    const frequency = getRandomFrequency();
    
    // Crear registro de ruta
    await db.insert(busRoutes).values({
      id: routeId,
      name: routeName,
      shortName: `R${routeId}`,
      color: color,
      frequency: frequency,
      scheduleStart: '05:00',
      scheduleEnd: '23:00',
      stopsCount: 0, // Se actualizará después
      approximateTime: approximateTime,
      zone: zone,
      popular: routeId <= 10, // Las primeras 10 rutas son populares
      geoJSON: routeData
    });
    
    // Procesar paradas si están disponibles
    if (stopsFilePath && fs.existsSync(stopsFilePath)) {
      try {
        const stopsData = JSON.parse(fs.readFileSync(stopsFilePath, 'utf8'));
        
        if (stopsData.features && stopsData.features.length > 0) {
          console.log(`Importando ${stopsData.features.length} paradas para ruta ${routeId}`);
          
          for (let i = 0; i < stopsData.features.length; i++) {
            const stopFeature = stopsData.features[i];
            const stopGeometry = stopFeature.geometry;
            const stopProperties = stopFeature.properties || {};
            
            if (stopGeometry.type !== 'Point') {
              console.warn(`Tipo de geometría de parada no soportado: ${stopGeometry.type}`);
              continue;
            }
            
            const position = stopGeometry.coordinates;
            
            // Verificar que las coordenadas sean válidas
            if (!Array.isArray(position) || position.length !== 2 || 
                typeof position[0] !== 'number' || typeof position[1] !== 'number') {
              console.warn(`Coordenadas inválidas para parada ${i} de ruta ${routeId}`);
              continue;
            }
            
            // Determinar si es terminal
            const isTerminal = i === 0 || i === stopsData.features.length - 1;
            const terminalType = i === 0 ? 'origin' : (i === stopsData.features.length - 1 ? 'destination' : '');
            
            // Crear nombre de parada
            const stopName = stopProperties.name || 
                            stopProperties.description || 
                            `Parada ${i + 1}`;
            
            // Crear parada
            await db.insert(busStops).values({
              routeId: routeId,
              name: stopName,
              latitude: position[1].toString(),
              longitude: position[0].toString(),
              order: i,
              isTerminal: isTerminal,
              terminalType: terminalType
            });
            
            stopsCount++;
          }
        } else {
          console.log(`Archivo de paradas no tiene características: ${stopsFilePath}`);
        }
      } catch (error) {
        console.error(`Error procesando paradas para ruta ${routeId}:`, error);
      }
    } else if (stopsFilePath) {
      console.warn(`Archivo de paradas no encontrado: ${stopsFilePath}`);
    } else {
      console.log(`No se especificó archivo de paradas para ruta ${routeId}`);
    }
    
    // Actualizar contador de paradas
    if (stopsCount > 0) {
      await db.execute(`UPDATE bus_routes SET stops_count = ${stopsCount} WHERE id = ${routeId}`);
      console.log(`Actualizado contador de paradas para ruta ${routeId}: ${stopsCount} paradas`);
    }
    
    return { stopsCount };
  } catch (error) {
    console.error(`Error importando ruta ${routeId}:`, error);
    return { stopsCount: 0 };
  }
}

// Importar una sola ruta según el ID
async function importSingleRoute(routeId: number) {
  console.log(`Importando ruta ${routeId}...`);
  
  // Eliminar ruta existente si existe
  await db.delete(busStops).where(eq(busStops.routeId, routeId));
  await db.delete(busRoutes).where(eq(busRoutes.id, routeId));
  
  const baseDir = './tmp/corregidos2/Corregidos2';
  
  const files = fs.readdirSync(baseDir);
  
  // Buscar archivos de ruta y paradas para este ID
  const routeFile = files.find(f => f.match(new RegExp(`^${routeId}_route\\.geojson$`)));
  const stopsFile = files.find(f => f.match(new RegExp(`^${routeId}_stops?\\.geojson$`)));
  
  if (routeFile) {
    const routePath = path.join(baseDir, routeFile);
    const stopsPath = stopsFile ? path.join(baseDir, stopsFile) : undefined;
    
    const result = await importRouteWithStops(
      routeId,
      `Ruta ${routeId}`,
      routePath,
      stopsPath
    );
    
    console.log(`Importada ruta ${routeId} con ${result.stopsCount} paradas`);
  } else {
    // Comprobar si es una ruta con ida/vuelta
    const idaRouteFile = files.find(f => f.match(new RegExp(`^${routeId}_ida_route\\.geojson$`)));
    const idaStopsFile = files.find(f => f.match(new RegExp(`^${routeId}_ida_stops?\\.geojson$`)));
    
    const vueltaRouteFile = files.find(f => f.match(new RegExp(`^${routeId}_vuelta_route\\.geojson$`)));
    const vueltaStopsFile = files.find(f => f.match(new RegExp(`^${routeId}_vuelta_stops?\\.geojson$`)));
    
    if (idaRouteFile) {
      const idaId = routeId * 1000 + 1; // Ejemplo: 3001 para ruta 3 ida
      
      // Eliminar variante existente si existe
      await db.delete(busStops).where(eq(busStops.routeId, idaId));
      await db.delete(busRoutes).where(eq(busRoutes.id, idaId));
      
      const idaPath = path.join(baseDir, idaRouteFile);
      const idaStopsPath = idaStopsFile ? path.join(baseDir, idaStopsFile) : undefined;
      
      const idaResult = await importRouteWithStops(
        idaId,
        `Ruta ${routeId} (Ida)`,
        idaPath,
        idaStopsPath
      );
      
      console.log(`Importada ruta ${routeId} (Ida) con ${idaResult.stopsCount} paradas`);
    }
    
    if (vueltaRouteFile) {
      const vueltaId = routeId * 1000 + 2; // Ejemplo: 3002 para ruta 3 vuelta
      
      // Eliminar variante existente si existe
      await db.delete(busStops).where(eq(busStops.routeId, vueltaId));
      await db.delete(busRoutes).where(eq(busRoutes.id, vueltaId));
      
      const vueltaPath = path.join(baseDir, vueltaRouteFile);
      const vueltaStopsPath = vueltaStopsFile ? path.join(baseDir, vueltaStopsFile) : undefined;
      
      const vueltaResult = await importRouteWithStops(
        vueltaId,
        `Ruta ${routeId} (Vuelta)`,
        vueltaPath,
        vueltaStopsPath
      );
      
      console.log(`Importada ruta ${routeId} (Vuelta) con ${vueltaResult.stopsCount} paradas`);
    }
    
    if (!idaRouteFile && !vueltaRouteFile) {
      console.log(`No se encontraron archivos para la ruta ${routeId}`);
    }
  }
}

// Función principal
async function main() {
  // Obtener ID de la ruta desde la línea de comandos
  const args = process.argv.slice(2);
  const routeId = parseInt(args[0], 10);
  
  if (isNaN(routeId)) {
    console.error('Por favor, proporciona un ID de ruta válido como argumento. Ejemplo: npx tsx scripts/import-single-route.ts 1');
    process.exit(1);
  }
  
  await importSingleRoute(routeId);
  console.log(`Importación de ruta ${routeId} completada.`);
}

main().catch(err => {
  console.error('Error durante la importación:', err);
  process.exit(1);
});