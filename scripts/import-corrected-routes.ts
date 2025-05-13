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

// Función principal para importar todas las rutas
async function importAllCorrectedRoutes() {
  console.log('Limpiando base de datos...');
  await db.delete(busStops);
  await db.delete(busRoutes);
  
  const baseDir = './tmp/corregidos2/Corregidos2';
  
  if (!fs.existsSync(baseDir)) {
    throw new Error(`Directorio no encontrado: ${baseDir}`);
  }
  
  const files = fs.readdirSync(baseDir);
  console.log(`Encontrados ${files.length} archivos en ${baseDir}`);
  
  // Agrupar archivos por ruta
  const routeFiles: Record<number, {
    id: number,
    name: string,
    variants: Array<{
      type: RouteType, 
      routeFile: string, 
      stopsFile?: string
    }>
  }> = {};
  
  // Primera pasada: identificar tipos de archivo y agruparlos
  for (const file of files) {
    if (!file.endsWith('.geojson')) continue;
    
    let routeId: number;
    let type: RouteType;
    let isRoute = false;
    let isStops = false;
    
    // Patrones para diferentes formatos de nombre de archivo
    if (file.match(/^\d+_route\.geojson$/)) {
      // Formato: 001_route.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'direct';
      isRoute = true;
    } 
    else if (file.match(/^\d+_ida_route\.geojson$/)) {
      // Formato: 003_ida_route.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'ida';
      isRoute = true;
    }
    else if (file.match(/^\d+_vuelta_route\.geojson$/)) {
      // Formato: 003_vuelta_route.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'vuelta';
      isRoute = true;
    }
    else if (file.match(/^\d+_routes?_ida\.geojson$/)) {
      // Formato: 020_routes_ida.geojson o 020_route_ida.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'ida';
      isRoute = true;
    }
    else if (file.match(/^\d+_routes?_vuelta\.geojson$/)) {
      // Formato: 020_routes_vuelta.geojson o 020_route_vuelta.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'vuelta';
      isRoute = true;
    }
    else if (file.match(/^\d+_stops\.geojson$/)) {
      // Formato: 001_stops.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'direct';
      isStops = true;
    }
    else if (file.match(/^\d+_ida_stops\.geojson$/)) {
      // Formato: 003_ida_stops.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'ida';
      isStops = true;
    }
    else if (file.match(/^\d+_vuelta_stops\.geojson$/)) {
      // Formato: 003_vuelta_stops.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'vuelta';
      isStops = true;
    }
    else if (file.match(/^\d+_stops?_ida\.geojson$/)) {
      // Formato: 020_stops_ida.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'ida';
      isStops = true;
    }
    else if (file.match(/^\d+_stops?_vuelta\.geojson$/)) {
      // Formato: 020_stops_vuelta.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'vuelta';
      isStops = true;
    }
    else if (file.match(/^\d+_stop\.geojson$/)) {
      // Formato: 013_stop.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'direct';
      isStops = true;
    }
    else if (file.match(/^\d+_ida_stop\.geojson$/)) {
      // Formato: 026_ida_stop.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'ida';
      isStops = true;
    }
    else if (file.match(/^\d+_vuelta_stop\.geojson$/)) {
      // Formato: 026_vuelta_stop.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'vuelta';
      isStops = true;
    }
    else if (file.match(/^\d+_routes\.geojson$/)) {
      // Formato especial: 074_routes.geojson
      routeId = parseInt(file.split('_')[0]);
      type = 'direct';
      isRoute = true;
    }
    else {
      console.log(`Formato de archivo no reconocido: ${file}`);
      continue;
    }
    
    // Inicializar ruta si no existe
    if (!routeFiles[routeId]) {
      routeFiles[routeId] = {
        id: routeId,
        name: `Ruta ${routeId}`,
        variants: []
      };
    }
    
    // Añadir archivos a la variante existente o crear una nueva
    if (isRoute) {
      const existingVariant = routeFiles[routeId].variants.find(v => v.type === type);
      if (existingVariant) {
        existingVariant.routeFile = file;
      } else {
        routeFiles[routeId].variants.push({
          type,
          routeFile: file
        });
      }
    } else if (isStops) {
      const existingVariant = routeFiles[routeId].variants.find(v => v.type === type);
      if (existingVariant) {
        existingVariant.stopsFile = file;
      } else {
        // Si no hay una entrada de ruta para esta variante, crear una nueva con solo el archivo de paradas
        routeFiles[routeId].variants.push({
          type,
          routeFile: "", // Campo requerido aunque esté vacío
          stopsFile: file
        });
      }
    }
  }
  
  // Convertir a array para procesamiento
  const routesToProcess = Object.values(routeFiles);
  console.log(`Encontradas ${routesToProcess.length} rutas para procesar`);
  
  // Segunda pasada: Importar cada ruta
  let importedRoutes = 0;
  let importedVariants = 0;
  let importedStops = 0;
  
  // Importar un conjunto pequeño de rutas para probar
  const MAX_ROUTES_TO_IMPORT = 10; // Limitamos a 10 rutas para evitar tiempos de espera
  
  // Ordenar rutas por ID
  routesToProcess.sort((a, b) => a.id - b.id);
  
  for (let i = 0; i < Math.min(MAX_ROUTES_TO_IMPORT, routesToProcess.length); i++) {
    const routeInfo = routesToProcess[i];
    console.log(`Procesando ruta ${routeInfo.id}...`);
    
    for (const variant of routeInfo.variants) {
      if (!variant.routeFile) {
        console.warn(`Ruta ${routeInfo.id} (${variant.type}) no tiene archivo de ruta, omitiendo...`);
        continue;
      }
      
      // Crear un identificador único para cada variante
      let uniqueId: number;
      let routeName: string;
      
      if (variant.type === 'direct') {
        uniqueId = routeInfo.id;
        routeName = `Ruta ${routeInfo.id}`;
      } else if (variant.type === 'ida') {
        uniqueId = routeInfo.id * 1000 + 1; // Ejemplo: 3001 para ruta 3 ida
        routeName = `Ruta ${routeInfo.id} (Ida)`;
      } else { // vuelta
        uniqueId = routeInfo.id * 1000 + 2; // Ejemplo: 3002 para ruta 3 vuelta
        routeName = `Ruta ${routeInfo.id} (Vuelta)`;
      }
      
      try {
        // Verificar si la ruta ya existe (por seguridad)
        const existingRoute = await db.select()
          .from(busRoutes)
          .where(eq(busRoutes.id, uniqueId))
          .limit(1);
          
        if (existingRoute && existingRoute.length > 0) {
          console.log(`La ruta ${uniqueId} (${routeName}) ya existe, eliminándola primero...`);
          await db.delete(busStops).where(eq(busStops.routeId, uniqueId));
          await db.delete(busRoutes).where(eq(busRoutes.id, uniqueId));
        }
        
        // Importar ruta y paradas
        const result = await importRouteWithStops(
          uniqueId,
          routeName,
          path.join(baseDir, variant.routeFile),
          variant.stopsFile ? path.join(baseDir, variant.stopsFile) : undefined
        );
        
        // Verificar que la ruta se haya creado correctamente
        const [createdRoute] = await db.select({ count: busRoutes.stopsCount })
          .from(busRoutes)
          .where(eq(busRoutes.id, uniqueId));
          
        if (!createdRoute) {
          throw new Error(`La ruta ${uniqueId} no se creó correctamente`);
        }
        
        if (createdRoute.count !== result.stopsCount) {
          console.warn(`El contador de paradas para ruta ${uniqueId} no coincide: DB=${createdRoute.count}, Importado=${result.stopsCount}`);
          await db.execute(`UPDATE bus_routes SET stops_count = ${result.stopsCount} WHERE id = ${uniqueId}`);
        }
        
        console.log(`Importada ruta ${uniqueId} (${routeName}) con ${result.stopsCount} paradas`);
        importedVariants++;
        importedStops += result.stopsCount;
      } catch (error) {
        console.error(`Error importando ruta ${routeInfo.id} (${variant.type}):`, error);
      }
    }
    
    importedRoutes++;
  }
  
  console.log(`Importación completada. Total: ${importedRoutes} rutas, ${importedVariants} variantes, ${importedStops} paradas.`);
}

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
      console.log(`Archivo de paradas no encontrado: ${stopsFilePath}`);
    } else {
      console.log(`No se especificó archivo de paradas para ruta ${routeId}`);
    }
  } catch (error) {
    console.error(`Error general procesando ruta ${routeId}:`, error);
  }
  
  // Actualizar contador de paradas en la ruta de manera explícita e inmediata
  if (stopsCount > 0) {
    try {
      const result = await db.update(busRoutes)
        .set({ stopsCount })
        .where(eq(busRoutes.id, routeId))
        .returning({ updatedCount: busRoutes.stopsCount });
      
      if (result && result.length > 0) {
        console.log(`Actualizado contador de paradas para ruta ${routeId}: ${result[0].updatedCount} paradas`);
      } else {
        console.log(`Actualizado contador de paradas para ruta ${routeId}: ${stopsCount} paradas`);
      }
      
      // Verificación adicional
      const [updatedRoute] = await db.select({ count: busRoutes.stopsCount })
        .from(busRoutes)
        .where(eq(busRoutes.id, routeId));
        
      if (updatedRoute && updatedRoute.count !== stopsCount) {
        console.warn(`¡Advertencia! El contador de paradas para ruta ${routeId} no se actualizó correctamente.`);
        console.warn(`Esperado: ${stopsCount}, Actual: ${updatedRoute.count}`);
        
        // Intento adicional de actualización
        await db.execute(
          `UPDATE bus_routes SET stops_count = ${stopsCount} WHERE id = ${routeId}`
        );
        
        console.log(`Intento adicional de actualización completado para ruta ${routeId}`);
      }
    } catch (error) {
      console.error(`Error al actualizar contador de paradas para ruta ${routeId}:`, error);
    }
  } else {
    console.log(`No hay paradas que actualizar para ruta ${routeId}`);
  }
  
  return { stopsCount };
}

// Ejecutar importación
importAllCorrectedRoutes()
  .then(() => {
    console.log('Importación completada exitosamente');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en la importación:', error);
    process.exit(1);
  });