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
const BATCH_SIZE = 1; // Procesar solo una ruta a la vez
const START_INDEX = 1; // Comenzar desde esta ruta (1-indexed)

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

// Función principal para iniciar el procesamiento
async function processAllRoutes() {
  console.log('Iniciando procesamiento de todas las rutas Mapaton...');
  
  try {
    // No limpiamos la base de datos para preservar las rutas ya importadas
    console.log('Manteniendo rutas existentes...');
    
    // Obtener lista de carpetas de rutas
    const routeFolders = fs.readdirSync(SHAPEFILES_DIR)
      .filter(folder => folder.endsWith('_circuito') || folder.endsWith('_ruta'))
      .filter(folder => !fs.lstatSync(path.join(SHAPEFILES_DIR, folder)).isFile());
    
    console.log(`Encontradas ${routeFolders.length} carpetas de rutas`);
    
    // Extraer información de ruta de cada carpeta
    const routeInfo = routeFolders.map(folder => {
      const parts = folder.split('_');
      const id = parseInt(parts[0], 10);
      return {
        id,
        folder,
        path: path.join(SHAPEFILES_DIR, folder)
      };
    }).filter(info => !isNaN(info.id));
    
    // Ordenar rutas por ID
    routeInfo.sort((a, b) => a.id - b.id);
    
    // Filtrar rutas para comenzar desde START_INDEX
    const filteredRouteInfo = routeInfo.filter(route => route.id >= START_INDEX);
    
    // Procesar rutas en lotes
    const totalRoutes = filteredRouteInfo.length;
    const totalAllRoutes = routeInfo.length;
    const batches = Math.ceil(totalRoutes / BATCH_SIZE);
    
    console.log(`Procesando ${totalRoutes} rutas (de ${totalAllRoutes} totales) en ${batches} lotes de ${BATCH_SIZE}`);
    console.log(`Comenzando desde la ruta ID ${START_INDEX}`);
    
    let successCount = 0;
    let errorCount = 0;
    let totalStops = 0;
    
    for (let batch = 0; batch < batches; batch++) {
      const start = batch * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, totalRoutes);
      const currentBatch = filteredRouteInfo.slice(start, end);
      
      console.log(`\n--- Procesando lote ${batch + 1}/${batches} (rutas ${start + 1}-${end}) ---`);
      
      for (const route of currentBatch) {
        try {
          console.log(`\nProcesando ruta ${route.id} (${route.folder})...`);
          const routePath = route.path;
          
          // Determinar si la ruta tiene ida/vuelta o es directa
          const hasIda = fs.existsSync(path.join(routePath, 'ida'));
          const hasVuelta = fs.existsSync(path.join(routePath, 'vuelta'));
          const hasDirect = fs.existsSync(path.join(routePath, 'route.zip'));
          
          if (hasDirect) {
            // Procesar ruta directa
            const { route: newRoute, stopsCount } = await processRouteFromShapefile(
              route.id, 
              routePath, 
              'direct'
            );
            
            if (newRoute) {
              console.log(`Ruta ${route.id} (directa) importada con éxito. ID: ${newRoute.id}`);
              successCount++;
              totalStops += stopsCount;
            }
          }
          
          if (hasIda) {
            // Procesar ruta de ida
            const { route: newRoute, stopsCount } = await processRouteFromShapefile(
              route.id, 
              path.join(routePath, 'ida'),
              'ida'
            );
            
            if (newRoute) {
              console.log(`Ruta ${route.id} (ida) importada con éxito. ID: ${newRoute.id}`);
              successCount++;
              totalStops += stopsCount;
            }
          }
          
          if (hasVuelta) {
            // Procesar ruta de vuelta
            const { route: newRoute, stopsCount } = await processRouteFromShapefile(
              route.id, 
              path.join(routePath, 'vuelta'),
              'vuelta',
              100 // Offset pequeño para IDs de vuelta
            );
            
            if (newRoute) {
              console.log(`Ruta ${route.id} (vuelta) importada con éxito. ID: ${newRoute.id}`);
              successCount++;
              totalStops += stopsCount;
            }
          }
          
          if (!hasDirect && !hasIda && !hasVuelta) {
            console.log(`⚠️ Ruta ${route.id} no tiene archivos de ruta válidos, omitiendo...`);
            errorCount++;
          }
          
        } catch (error) {
          console.error(`❌ Error procesando ruta ${route.id}:`, error);
          errorCount++;
        }
      }
      
      console.log(`\n--- Lote ${batch + 1}/${batches} completado ---`);
      console.log(`Progreso: ${successCount} rutas importadas, ${errorCount} errores, ${totalStops} paradas`);
    }
    
    console.log(`\n=== Procesamiento completado ===`);
    console.log(`Total: ${successCount} rutas importadas, ${errorCount} errores, ${totalStops} paradas`);
    
    return { successCount, errorCount, totalStops };
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
    const descLower = desc.toLowerCase();
    
    if (descLower.includes('norte')) return 'norte';
    if (descLower.includes('sur')) return 'sur';
    if (descLower.includes('este') || descLower.includes('oriente')) return 'este';
    if (descLower.includes('oeste') || descLower.includes('poniente')) return 'oeste';
    if (descLower.includes('centro')) return 'centro';
  }
  
  // Asignar zona basada en rangos de ID
  if (routeId < 20) return 'centro';
  if (routeId < 40) return 'norte';
  if (routeId < 60) return 'sur';
  if (routeId < 80) return 'este';
  return 'oeste';
}

// Función para calcular tiempo aproximado basado en puntos
function approximateTimeFromPoints(points: number): string {
  const baseTime = Math.max(15, Math.min(60, Math.floor(points / 20)));
  return `${baseTime} minutos`;
}

// Función para generar frecuencia aleatoria
function getRandomFrequency(): string {
  const minutes = Math.floor(Math.random() * 10) + 5; // 5-15 minutos
  return `${minutes} minutos`;
}

// Función para buscar archivos recursivamente
function findFiles(dir: string, extension: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, extension));
    } else if (entry.name.endsWith(extension)) {
      results.push(fullPath);
    }
  }
  
  return results;
}

// Ejecutar el procesamiento
async function main() {
  try {
    const result = await processAllRoutes();
    console.log('Procesamiento finalizado con éxito:', result);
    process.exit(0);
  } catch (error) {
    console.error('Error fatal en el procesamiento:', error);
    process.exit(1);
  }
}

// Iniciar procesamiento
main();