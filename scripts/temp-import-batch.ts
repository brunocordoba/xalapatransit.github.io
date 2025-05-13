import * as fs from 'fs';
import * as path from 'path';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';
import * as util from 'util';
import { exec } from 'child_process';

// Promisificar exec para usar con async/await
const execAsync = util.promisify(exec);

// Constantes para directorios y archivos
const SHAPEFILES_DIR = './tmp/mapaton-extract/shapefiles-mapton-ciudadano';
const PROCESSED_DIR = './tmp/processed';

// Crear directorios de procesamiento si no existen
if (!fs.existsSync(PROCESSED_DIR)) {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
}

// Colores para zonas
const zoneColors: Record<string, string> = {
  'norte': '#EF4444', // red-500
  'sur': '#3B82F6',   // blue-500
  'este': '#22C55E',  // green-500
  'oeste': '#A855F7', // purple-500
  'centro': '#F97316' // orange-500
};

// Procesar rutas en el rango especificado
async function processRoutesInRange() {
  try {
    console.log('Iniciando procesamiento de rutas en rango...');
    
    // Rango de rutas a procesar
    const minRouteId = 11;
    const maxRouteId = 15;
    
    console.log(`Procesando rutas del ${minRouteId} al ${maxRouteId}...`);
    
    // Obtener todos los directorios de rutas disponibles
    const directories = fs.readdirSync(SHAPEFILES_DIR)
      .filter(folder => !fs.lstatSync(path.join(SHAPEFILES_DIR, folder)).isFile());
    
    console.log(`Encontrados ${directories.length} directorios de rutas en total`);
    
    // Extraer información de cada ruta
    const routeFolders = directories
      .filter(folder => folder.endsWith('_circuito') || folder.endsWith('_ruta'))
      .map(folder => {
        const parts = folder.split('_');
        const routeId = parseInt(parts[0], 10);
        return {
          id: routeId,
          folder,
          path: path.join(SHAPEFILES_DIR, folder)
        };
      })
      .filter(route => !isNaN(route.id));
    
    // Organizar rutas por ID
    const routesById = new Map<number, typeof routeFolders[0][]>();
    
    // Agrupar rutas por ID para evitar duplicados
    for (const route of routeFolders) {
      if (!routesById.has(route.id)) {
        routesById.set(route.id, []);
      }
      routesById.get(route.id)!.push(route);
    }
    
    // Estadísticas de procesamiento
    let successCount = 0;
    let errorCount = 0;
    let totalStopsCount = 0;
    let skippedCount = 0;
    
    // Procesar cada ruta en el rango especificado
    for (let currentRouteId = minRouteId; currentRouteId <= maxRouteId; currentRouteId++) {
      console.log(`\n=== Procesando Ruta ${currentRouteId} ===`);
      
      // Verificar si existe la carpeta para esta ruta
      const routesWithThisId = routesById.get(currentRouteId) || [];
      
      if (routesWithThisId.length === 0) {
        console.log(`No se encontró carpeta para la Ruta ${currentRouteId}, omitiendo...`);
        skippedCount++;
        continue;
      }
      
      // Para cada carpeta de ruta (puede haber múltiples con el mismo ID)
      for (const route of routesWithThisId) {
        try {
          console.log(`Procesando ${route.folder}...`);
          
          // Determinar subprocesado (ida/vuelta o directa)
          const hasIda = fs.existsSync(path.join(route.path, 'ida'));
          const hasVuelta = fs.existsSync(path.join(route.path, 'vuelta'));
          const hasDirect = fs.existsSync(path.join(route.path, 'route.zip'));
          
          if (hasDirect) {
            // Procesar ruta directa
            const { route: newRoute, stopsCount } = await processRouteFromShapefile(
              currentRouteId,
              route.path, 
              'direct'
            );
            
            if (newRoute) {
              console.log(`Ruta ${currentRouteId} (directa) importada con éxito. ID: ${newRoute.id}`);
              successCount++;
              totalStopsCount += stopsCount;
            }
          }
          
          if (hasIda) {
            // Procesar ruta de ida
            const { route: newRoute, stopsCount } = await processRouteFromShapefile(
              currentRouteId,
              path.join(route.path, 'ida'),
              'ida'
            );
            
            if (newRoute) {
              console.log(`Ruta ${currentRouteId} (ida) importada con éxito. ID: ${newRoute.id}`);
              successCount++;
              totalStopsCount += stopsCount;
            }
          }
          
          if (hasVuelta) {
            // Procesar ruta de vuelta
            const { route: newRoute, stopsCount } = await processRouteFromShapefile(
              currentRouteId,
              path.join(route.path, 'vuelta'),
              'vuelta',
              100 // Offset pequeño para IDs de vuelta
            );
            
            if (newRoute) {
              console.log(`Ruta ${currentRouteId} (vuelta) importada con éxito. ID: ${newRoute.id}`);
              successCount++;
              totalStopsCount += stopsCount;
            }
          }
          
          if (!hasDirect && !hasIda && !hasVuelta) {
            console.log(`⚠️ Ruta ${currentRouteId} no tiene archivos de ruta válidos en ${route.folder}, omitiendo...`);
            errorCount++;
          }
          
        } catch (error) {
          console.error(`❌ Error procesando ruta ${currentRouteId} (${route.folder}):`, error);
          errorCount++;
        }
      }
      
      // Mostramos estadísticas después de cada ruta (todas sus variantes)
      console.log(`Progreso: ${successCount} rutas importadas, ${errorCount} errores, ${skippedCount} omitidas, ${totalStopsCount} paradas creadas`);
    }
    
    console.log(`\n=== Procesamiento de lote completado ===`);
    console.log(`Total: ${successCount} rutas importadas, ${errorCount} errores, ${skippedCount} omitidas, ${totalStopsCount} paradas`);
    
    return { successCount, errorCount, skippedCount, totalStopsCount };
  } catch (error) {
    console.error('Error en el procesamiento general:', error);
    throw error;
  }
}

// Función para procesar una ruta desde shapefile
async function processRouteFromShapefile(
  baseId: number,
  routePath: string,
  routeType: 'direct' | 'ida' | 'vuelta', 
  idOffset: number = 0
): Promise<{ route: any, stopsCount: number }> {
  // Determinar ID final y sufijo de nombre
  const routeId = baseId + idOffset;
  const routeTypeSuffix = routeType === 'direct' ? '' : 
                          (routeType === 'ida' ? ' (Ida)' : ' (Vuelta)');
  
  // Verificar si la ruta ya existe (para evitar duplicados)
  try {
    // Consultar por nombre exacto para verificar duplicados
    const routeName = `Ruta ${baseId}${routeTypeSuffix}`;
    const existingRoutes = await db.query.busRoutes.findMany({
      where: (busRoutes, { eq }) => eq(busRoutes.name, routeName)
    });
    
    if (existingRoutes.length > 0) {
      console.log(`La ruta ${routeName} ya existe en la base de datos, omitiendo...`);
      return { route: existingRoutes[0], stopsCount: 0 };
    }
  } catch (error) {
    console.warn('Error verificando existencia de ruta:', error);
    // Continuamos de todos modos, el error podría ser por conexión
  }
  
  // Verificar archivos de ruta y paradas
  const routeZipPath = path.join(routePath, 'route.zip');
  const stopsZipPath = path.join(routePath, 'stops.zip');
  
  if (!fs.existsSync(routeZipPath)) {
    throw new Error(`Archivo route.zip no encontrado en ${routePath}`);
  }
  
  // Crear directorios temporales para extracción
  const tmpDir = path.join(PROCESSED_DIR, `route_${routeId}`);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  
  const routeShpDir = path.join(tmpDir, 'route');
  if (!fs.existsSync(routeShpDir)) {
    fs.mkdirSync(routeShpDir, { recursive: true });
  }
  
  const stopsShpDir = path.join(tmpDir, 'stops');
  if (!fs.existsSync(stopsShpDir)) {
    fs.mkdirSync(stopsShpDir, { recursive: true });
  }
  
  try {
    // Extraer archivo de ruta
    await execAsync(`unzip -o "${routeZipPath}" -d "${routeShpDir}"`);
    
    // Buscar archivo .shp para la ruta
    const routeShpFiles = findFiles(routeShpDir, '.shp');
    if (routeShpFiles.length === 0) {
      throw new Error(`No se encontraron archivos .shp en ${routeShpDir}`);
    }
    
    // Convertir shapefile de ruta a GeoJSON
    const routeShpFile = routeShpFiles[0];
    const routeGeoJsonFile = path.join(tmpDir, 'route.geojson');
    
    await execAsync(`ogr2ogr -f GeoJSON "${routeGeoJsonFile}" "${routeShpFile}"`);
    
    if (!fs.existsSync(routeGeoJsonFile)) {
      throw new Error(`Error al convertir shapefile a GeoJSON: ${routeShpFile}`);
    }
    
    // Leer archivo GeoJSON y extraer datos
    const routeGeoJson = JSON.parse(fs.readFileSync(routeGeoJsonFile, 'utf8'));
    
    if (!routeGeoJson || !routeGeoJson.features || routeGeoJson.features.length === 0) {
      throw new Error(`No se encontraron características en el GeoJSON de la ruta`);
    }
    
    // Usar primera característica como ruta
    const routeFeature = routeGeoJson.features[0];
    const routeCoordinates = routeFeature.geometry?.coordinates || [];
    
    if (!routeCoordinates || routeCoordinates.length === 0) {
      throw new Error(`No se encontraron coordenadas en la ruta`);
    }
    
    // Determinar zona
    const zone = determineZone(routeId, routeFeature.properties);
    
    // Generar nombre y color
    // Para rutas de vuelta, usamos el ID base (sin offset) para mantener el nombre correcto
    const displayRouteId = routeType === 'vuelta' ? baseId : routeId;
    const routeName = `Ruta ${displayRouteId}${routeTypeSuffix}`;
    const shortName = `R${displayRouteId}${routeType !== 'direct' ? routeType.charAt(0).toUpperCase() : ''}`;
    const color = zoneColors[zone];
    
    // Crear objeto GeoJSON para la ruta
    const finalRouteGeoJSON = {
      type: "Feature",
      properties: {
        id: routeId,
        name: routeName,
        shortName: shortName,
        color: color
      },
      geometry: {
        type: "LineString",
        coordinates: routeCoordinates
      }
    };
    
    // Generar datos complementarios
    const approximateTime = approximateTimeFromPoints(routeCoordinates.length);
    const frequency = getRandomFrequency();
    
    // Crear ruta en la base de datos
    const route = await storage.createRoute({
      name: routeName,
      shortName: shortName,
      color: color,
      frequency: frequency,
      scheduleStart: '05:30 AM',
      scheduleEnd: '22:30 PM',
      stopsCount: 0, // Se actualizará después
      approximateTime: approximateTime,
      zone: zone,
      popular: true,
      geoJSON: finalRouteGeoJSON
    });
    
    console.log(`✅ Ruta creada: ${routeName} (ID: ${route.id}) con ${routeCoordinates.length} puntos`);
    
    // Procesar paradas si existen
    let stopsCount = 0;
    
    try {
      if (fs.existsSync(stopsZipPath)) {
        // Extraer archivo de paradas
        await execAsync(`unzip -o "${stopsZipPath}" -d "${stopsShpDir}"`);
        
        // Buscar archivo .shp para las paradas
        const stopsShpFiles = findFiles(stopsShpDir, '.shp');
        
        if (stopsShpFiles.length > 0) {
          // Convertir shapefile de paradas a GeoJSON
          const stopsShpFile = stopsShpFiles[0];
          const stopsGeoJsonFile = path.join(tmpDir, 'stops.geojson');
          
          await execAsync(`ogr2ogr -f GeoJSON "${stopsGeoJsonFile}" "${stopsShpFile}"`);
          
          if (fs.existsSync(stopsGeoJsonFile)) {
            // Leer archivo GeoJSON y extraer datos
            const stopsGeoJson = JSON.parse(fs.readFileSync(stopsGeoJsonFile, 'utf8'));
            
            if (stopsGeoJson && stopsGeoJson.features && stopsGeoJson.features.length > 0) {
              // Crear paradas
              stopsCount = await createStopsFromGeoJSON(route.id, stopsGeoJson);
              console.log(`✅ Creadas ${stopsCount} paradas para la ruta ${route.id}`);
            } else {
              console.log(`No se encontraron paradas en el GeoJSON, generando automáticamente...`);
              stopsCount = await generateAutomaticStops(route.id, routeCoordinates);
            }
          } else {
            console.log(`Error al convertir shapefile de paradas a GeoJSON, generando automáticamente...`);
            stopsCount = await generateAutomaticStops(route.id, routeCoordinates);
          }
        } else {
          console.log(`No se encontraron archivos .shp para paradas, generando automáticamente...`);
          stopsCount = await generateAutomaticStops(route.id, routeCoordinates);
        }
      } else {
        console.log(`No se encontró archivo stops.zip, generando paradas automáticamente...`);
        stopsCount = await generateAutomaticStops(route.id, routeCoordinates);
      }
    } catch (error) {
      console.error(`Error procesando paradas para ruta ${routeId}:`, error);
      // Si hay error al generar paradas, continuamos con 0 paradas
    }
    
    return { route, stopsCount };
  } catch (error) {
    console.error(`Error procesando ruta ${routeId}:`, error);
    throw error;
  }
}

// Función para crear paradas desde GeoJSON
async function createStopsFromGeoJSON(routeId: number, stopsGeoJson: any): Promise<number> {
  try {
    const features = stopsGeoJson.features || [];
    if (features.length === 0) {
      return 0;
    }
    
    let count = 0;
    
    // Primera parada es terminal origen
    const firstStop = features[0];
    const firstCoord = firstStop.geometry.coordinates;
    
    await storage.createStop({
      routeId: routeId,
      name: `Terminal Origen (R${routeId})`,
      latitude: firstCoord[1].toString(),
      longitude: firstCoord[0].toString(),
      isTerminal: true,
      terminalType: 'first'
    });
    count++;
    
    // Paradas intermedias
    for (let i = 1; i < features.length - 1; i++) {
      const stop = features[i];
      const coord = stop.geometry.coordinates;
      
      await storage.createStop({
        routeId: routeId,
        name: `Parada ${i}`,
        latitude: coord[1].toString(),
        longitude: coord[0].toString(),
        isTerminal: false,
        terminalType: ''
      });
      count++;
    }
    
    // Última parada es terminal destino
    if (features.length > 1) {
      const lastStop = features[features.length - 1];
      const lastCoord = lastStop.geometry.coordinates;
      
      await storage.createStop({
        routeId: routeId,
        name: `Terminal Destino (R${routeId})`,
        latitude: lastCoord[1].toString(),
        longitude: lastCoord[0].toString(),
        isTerminal: true,
        terminalType: 'last'
      });
      count++;
    }
    
    // Actualizar contador de paradas en la ruta
    await storage.updateRoute(routeId, { stopsCount: count });
    
    return count;
  } catch (error) {
    console.error(`Error creando paradas para ruta ${routeId}:`, error);
    return 0;
  }
}

// Función para generar paradas automáticas
async function generateAutomaticStops(routeId: number, coordinates: [number, number][]): Promise<number> {
  try {
    if (!coordinates || coordinates.length < 2) {
      return 0;
    }
    
    // Determinar número óptimo de paradas según longitud de la ruta
    const totalStops = Math.min(
      Math.max(10, Math.floor(coordinates.length / 50)),
      40 // máximo 40 paradas para tener una mejor distribución
    );
    
    let count = 0;
    
    // Terminal origen
    const firstCoord = coordinates[0];
    await storage.createStop({
      routeId: routeId,
      name: `Terminal Origen (R${routeId})`,
      latitude: firstCoord[1].toString(),
      longitude: firstCoord[0].toString(),
      isTerminal: true,
      terminalType: 'first'
    });
    count++;
    
    // Paradas intermedias
    const step = Math.floor(coordinates.length / (totalStops - 1));
    for (let i = 1; i < totalStops - 1; i++) {
      const index = i * step;
      if (index < coordinates.length) {
        const coord = coordinates[index];
        await storage.createStop({
          routeId: routeId,
          name: `Parada ${i}`,
          latitude: coord[1].toString(),
          longitude: coord[0].toString(),
          isTerminal: false,
          terminalType: ''
        });
        count++;
      }
    }
    
    // Terminal destino
    const lastCoord = coordinates[coordinates.length - 1];
    await storage.createStop({
      routeId: routeId,
      name: `Terminal Destino (R${routeId})`,
      latitude: lastCoord[1].toString(),
      longitude: lastCoord[0].toString(),
      isTerminal: true,
      terminalType: 'last'
    });
    count++;
    
    // Actualizar contador de paradas en la ruta
    await storage.updateRoute(routeId, { stopsCount: count });
    
    return count;
  } catch (error) {
    console.error(`Error generando paradas automáticas para ruta ${routeId}:`, error);
    return 0;
  }
}

// Función para determinar zona
function determineZone(routeId: number, properties: any): string {
  // Intentar extraer información de zona de las propiedades
  if (properties) {
    const desc = properties.desc || properties.description || properties.name || '';
    const descLower = desc.toString().toLowerCase();
    
    if (descLower.includes('norte')) return 'norte';
    if (descLower.includes('sur')) return 'sur';
    if (descLower.includes('este') || descLower.includes('oriente')) return 'este';
    if (descLower.includes('oeste') || descLower.includes('poniente')) return 'oeste';
    if (descLower.includes('centro')) return 'centro';
  }
  
  // Asignar zonas según rangos de IDs si no hay información explícita
  if (routeId >= 1 && routeId <= 30) return 'norte';
  if (routeId >= 31 && routeId <= 60) return 'sur';
  if (routeId >= 61 && routeId <= 90) return 'este';
  if (routeId >= 91 && routeId <= 120) return 'oeste';
  
  // Default para rutas sin zona clara
  return 'centro';
}

// Utilidad para aproximar tiempo basado en número de puntos
function approximateTimeFromPoints(points: number): string {
  if (points < 50) return '15-20 min';
  if (points < 100) return '20-30 min';
  if (points < 200) return '30-45 min';
  if (points < 300) return '45-60 min';
  return '60+ min';
}

// Utilidad para generar frecuencia aleatoria
function getRandomFrequency(): string {
  const frequencies = [
    '10-15 min',
    '15-20 min',
    '20-30 min',
    '30-40 min',
    '15-25 min',
    '20-25 min'
  ];
  return frequencies[Math.floor(Math.random() * frequencies.length)];
}

// Utilidad para buscar archivos
function findFiles(dir: string, extension: string): string[] {
  try {
    return fs.readdirSync(dir)
      .filter(file => file.endsWith(extension))
      .map(file => path.join(dir, file));
  } catch (error) {
    console.error(`Error buscando archivos ${extension} en ${dir}:`, error);
    return [];
  }
}

// Ejecutar el procesamiento
async function main() {
  try {
    const result = await processRoutesInRange();
    console.log('Procesamiento finalizado con éxito:');
    console.log(`- ${result.successCount} rutas importadas`);
    console.log(`- ${result.errorCount} errores`);
    console.log(`- ${result.skippedCount} rutas omitidas (no encontradas)`);
    console.log(`- ${result.totalStopsCount} paradas creadas`);
    
    // Si hay rutas omitidas, sugerir próximo rango
    if (result.skippedCount > 0) {
      const nextStartRoute = 15 + 1;
      const nextEndRoute = nextStartRoute + 9; // Procesar 10 rutas más
      console.log(`\nPara continuar, ejecutar: bash scripts/import-routes-batch.sh ${nextStartRoute} ${nextEndRoute}`);
    }
  } catch (error) {
    console.error('Error en el procesamiento principal:', error);
    process.exit(1);
  }
}

// Iniciar procesamiento
main();
