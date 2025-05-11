import * as fs from 'fs';
import * as path from 'path';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';
import * as xml2js from 'xml2js';
import { exec } from 'child_process';
import * as util from 'util';

// Promisify exec
const execAsync = util.promisify(exec);

// Directorio base para los shapefiles
const SHAPEFILES_DIR = './tmp/extracted/shapefiles-mapton-ciudadano';
const TMP_DIR = './tmp/processed';

// Crear directorio temporal si no existe
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// IDs de rutas a importar como prueba (podemos modificar para importar todas)
const ROUTE_IDS_TO_IMPORT = [
  { id: 1, dir: "1_circuito" },
  { id: 10, dir: "10_circuito_alterno" },
  { id: 26, dir: "26_circuito" },
  { id: 52, dir: "52_circuito" },
  { id: 82, dir: "82_circuito" },
  { id: 95, dir: "95_circuito" }
];

// Colores para zonas
const zoneColors: { [key: string]: string } = {
  'norte': '#EF4444', // red-500
  'sur': '#3B82F6',   // blue-500
  'este': '#22C55E',  // green-500
  'oeste': '#A855F7', // purple-500
  'centro': '#F97316' // orange-500
};

// Función para importar rutas
async function importRoutes() {
  console.log('Iniciando importación de rutas desde shapefiles...');
  
  try {
    // Limpiar la base de datos antes de importar
    await db.delete(busStops);
    await db.delete(busRoutes);
    console.log('Base de datos limpia para la importación');
    
    let successCount = 0;
    let errorCount = 0;
    
    // Procesar cada ruta configurada
    for (const routeConfig of ROUTE_IDS_TO_IMPORT) {
      const { id: routeId, dir: routeDir } = routeConfig;
      
      try {
        console.log(`Procesando ruta ${routeId} (${routeDir})...`);
        
        // Construir ruta al directorio
        const routePath = path.join(SHAPEFILES_DIR, routeDir);
        
        // Verificar si es una ruta directa o con ida/vuelta
        const hasIda = fs.existsSync(path.join(routePath, 'ida'));
        const hasVuelta = fs.existsSync(path.join(routePath, 'vuelta'));
        const hasDirect = fs.existsSync(path.join(routePath, 'route.zip'));
        
        if (hasDirect) {
          await processDirectRoute(routeId, routePath);
          successCount++;
        } else if (hasIda || hasVuelta) {
          if (hasIda) {
            await processDirectionalRoute(routeId, routePath, 'ida');
            successCount++;
          }
          
          if (hasVuelta) {
            await processDirectionalRoute(routeId, routePath, 'vuelta');
            successCount++;
          }
        } else {
          console.log(`Ruta ${routeId} no tiene archivos de ruta válidos, omitiendo...`);
          errorCount++;
        }
      } catch (error) {
        console.error(`Error procesando ruta ${routeId}:`, error);
        errorCount++;
      }
    }
    
    console.log(`Importación completada: ${successCount} rutas importadas, ${errorCount} errores`);
    return { successCount, errorCount };
  } catch (error) {
    console.error('Error en la importación:', error);
    throw error;
  }
}

// Función para procesar ruta directa
async function processDirectRoute(routeId: number, routePath: string) {
  console.log(`Procesando ruta directa ${routeId}...`);
  
  // Ruta al archivo de ruta y paradas
  const routeZipPath = path.join(routePath, 'route.zip');
  const stopsZipPath = path.join(routePath, 'stops.zip');
  
  // Verificar si los archivos existen
  if (!fs.existsSync(routeZipPath)) {
    throw new Error(`Archivo de ruta no encontrado: ${routeZipPath}`);
  }
  
  // Nombre para archivos extraídos
  const tmpRouteDir = path.join(TMP_DIR, `route_${routeId}`);
  const tmpStopsDir = path.join(TMP_DIR, `stops_${routeId}`);
  
  // Crear directorios temporales
  if (!fs.existsSync(tmpRouteDir)) {
    fs.mkdirSync(tmpRouteDir, { recursive: true });
  }
  
  if (!fs.existsSync(tmpStopsDir)) {
    fs.mkdirSync(tmpStopsDir, { recursive: true });
  }
  
  // Extraer archivos
  try {
    await execAsync(`unzip -o "${routeZipPath}" -d "${tmpRouteDir}"`);
    console.log(`Archivo de ruta extraído en ${tmpRouteDir}`);
    
    // Si hay archivo de paradas, extraerlo también
    if (fs.existsSync(stopsZipPath)) {
      await execAsync(`unzip -o "${stopsZipPath}" -d "${tmpStopsDir}"`);
      console.log(`Archivo de paradas extraído en ${tmpStopsDir}`);
    }
    
    // Buscar archivos shp en los directorios
    const routeShpFiles = findFiles(tmpRouteDir, '.shp');
    if (routeShpFiles.length === 0) {
      throw new Error(`No se encontraron archivos .shp en ${tmpRouteDir}`);
    }
    
    const routeShpFile = routeShpFiles[0];
    console.log(`Usando archivo de ruta: ${routeShpFile}`);
    
    // Convertir shapefile a GeoJSON
    const routeGeoJsonPath = path.join(TMP_DIR, `route_${routeId}.json`);
    await convertShapefileToGeoJSON(routeShpFile, routeGeoJsonPath);
    
    // Leer archivo GeoJSON convertido
    const routeGeoJSON = JSON.parse(fs.readFileSync(routeGeoJsonPath, 'utf8'));
    
    if (!routeGeoJSON || !routeGeoJSON.features || routeGeoJSON.features.length === 0) {
      throw new Error(`No se pudieron extraer características del archivo GeoJSON: ${routeGeoJsonPath}`);
    }
    
    // Extraer la primera característica (debería ser la ruta)
    const routeFeature = routeGeoJSON.features[0];
    const coordinates = routeFeature.geometry?.coordinates;
    
    if (!coordinates || coordinates.length === 0) {
      throw new Error(`No se encontraron coordenadas en la ruta ${routeId}`);
    }
    
    // Determinar zona basada en las propiedades
    const zone = determineZone(routeFeature.properties);
    
    // Generar nombre y nombre corto
    const routeName = routeFeature.properties?.name || `Ruta ${routeId}`;
    const shortName = generateShortName(routeName);
    
    // Determinar color basado en la zona
    const color = zoneColors[zone] || '#3B82F6'; // default blue
    
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
        coordinates: coordinates
      }
    };
    
    // Generar información adicional para la ruta
    const approximateTime = generateApproximateTime(coordinates.length);
    const frequency = generateFrequency();
    
    // Crear la ruta en la base de datos
    const route = await storage.createRoute({
      name: routeName,
      shortName: shortName,
      color: color,
      frequency: frequency,
      scheduleStart: '05:30 AM',
      scheduleEnd: '10:30 PM',
      stopsCount: 0, // Se actualizará después
      approximateTime: approximateTime,
      zone: zone,
      popular: true, // Todas las rutas importadas son populares
      geoJSON: finalRouteGeoJSON
    });
    
    console.log(`Ruta creada: ${route.name} (ID: ${route.id})`);
    
    // Procesar paradas si existen
    if (fs.existsSync(stopsZipPath)) {
      await importStops(route.id, tmpStopsDir, coordinates);
    } else {
      // Generar paradas automáticas
      await generateAutomaticStops(route.id, coordinates);
    }
    
    return route;
  } catch (error) {
    console.error(`Error procesando ruta directa ${routeId}:`, error);
    throw error;
  }
}

// Función para procesar ruta direccional (ida/vuelta)
async function processDirectionalRoute(routeId: number, routePath: string, direction: string) {
  console.log(`Procesando ruta ${routeId} dirección ${direction}...`);
  
  const dirPath = path.join(routePath, direction);
  const routeZipPath = path.join(dirPath, 'route.zip');
  const stopsZipPath = path.join(dirPath, 'stops.zip');
  
  if (!fs.existsSync(routeZipPath)) {
    throw new Error(`Archivo de ruta no encontrado: ${routeZipPath}`);
  }
  
  // Generar un ID único para esta dirección
  const uniqueRouteId = direction === 'ida' ? routeId : routeId + 1000;
  
  // Crear nombre específico para dirección
  const dirSuffix = direction === 'ida' ? 'Ida' : 'Vuelta';
  
  // Continuar con el resto del proceso similar a processDirectRoute
  // pero ajustando nombres y IDs para reflejar la dirección
  const tmpRouteDir = path.join(TMP_DIR, `route_${uniqueRouteId}`);
  const tmpStopsDir = path.join(TMP_DIR, `stops_${uniqueRouteId}`);
  
  if (!fs.existsSync(tmpRouteDir)) {
    fs.mkdirSync(tmpRouteDir, { recursive: true });
  }
  
  if (!fs.existsSync(tmpStopsDir)) {
    fs.mkdirSync(tmpStopsDir, { recursive: true });
  }
  
  try {
    await execAsync(`unzip -o "${routeZipPath}" -d "${tmpRouteDir}"`);
    
    if (fs.existsSync(stopsZipPath)) {
      await execAsync(`unzip -o "${stopsZipPath}" -d "${tmpStopsDir}"`);
    }
    
    const routeShpFiles = findFiles(tmpRouteDir, '.shp');
    if (routeShpFiles.length === 0) {
      throw new Error(`No se encontraron archivos .shp en ${tmpRouteDir}`);
    }
    
    const routeShpFile = routeShpFiles[0];
    const routeGeoJsonPath = path.join(TMP_DIR, `route_${uniqueRouteId}.json`);
    await convertShapefileToGeoJSON(routeShpFile, routeGeoJsonPath);
    
    const routeGeoJSON = JSON.parse(fs.readFileSync(routeGeoJsonPath, 'utf8'));
    
    if (!routeGeoJSON || !routeGeoJSON.features || routeGeoJSON.features.length === 0) {
      throw new Error(`No se pudieron extraer características del archivo GeoJSON: ${routeGeoJsonPath}`);
    }
    
    const routeFeature = routeGeoJSON.features[0];
    const coordinates = routeFeature.geometry?.coordinates;
    
    if (!coordinates || coordinates.length === 0) {
      throw new Error(`No se encontraron coordenadas en la ruta ${uniqueRouteId}`);
    }
    
    const zone = determineZone(routeFeature.properties);
    const routeName = `${routeFeature.properties?.name || `Ruta ${routeId}`} (${dirSuffix})`;
    const shortName = `${generateShortName(routeName)}-${dirSuffix.charAt(0)}`;
    const color = zoneColors[zone] || '#3B82F6';
    
    const finalRouteGeoJSON = {
      type: "Feature",
      properties: {
        id: uniqueRouteId,
        name: routeName,
        shortName: shortName,
        color: color
      },
      geometry: {
        type: "LineString",
        coordinates: coordinates
      }
    };
    
    const approximateTime = generateApproximateTime(coordinates.length);
    const frequency = generateFrequency();
    
    const route = await storage.createRoute({
      name: routeName,
      shortName: shortName,
      color: color,
      frequency: frequency,
      scheduleStart: '05:30 AM',
      scheduleEnd: '10:30 PM',
      stopsCount: 0,
      approximateTime: approximateTime,
      zone: zone,
      popular: true,
      geoJSON: finalRouteGeoJSON
    });
    
    console.log(`Ruta direccional creada: ${route.name} (ID: ${route.id})`);
    
    if (fs.existsSync(stopsZipPath)) {
      await importStops(route.id, tmpStopsDir, coordinates);
    } else {
      await generateAutomaticStops(route.id, coordinates);
    }
    
    return route;
  } catch (error) {
    console.error(`Error procesando ruta direccional ${routeId} (${direction}):`, error);
    throw error;
  }
}

// Función para importar paradas
async function importStops(routeId: number, stopsDir: string, coordinates: [number, number][]) {
  console.log(`Importando paradas para ruta ${routeId}...`);
  
  try {
    // Buscar archivos shp en el directorio de paradas
    const stopsShpFiles = findFiles(stopsDir, '.shp');
    if (stopsShpFiles.length === 0) {
      console.log(`No se encontraron archivos .shp para paradas en ${stopsDir}, generando paradas automáticas...`);
      await generateAutomaticStops(routeId, coordinates);
      return;
    }
    
    const stopsShpFile = stopsShpFiles[0];
    console.log(`Usando archivo de paradas: ${stopsShpFile}`);
    
    // Convertir shapefile a GeoJSON
    const stopsGeoJsonPath = path.join(TMP_DIR, `stops_${routeId}.json`);
    await convertShapefileToGeoJSON(stopsShpFile, stopsGeoJsonPath);
    
    // Leer archivo GeoJSON convertido
    const stopsGeoJSON = JSON.parse(fs.readFileSync(stopsGeoJsonPath, 'utf8'));
    
    if (!stopsGeoJSON || !stopsGeoJSON.features || stopsGeoJSON.features.length === 0) {
      console.log(`No se pudieron extraer paradas del archivo GeoJSON, generando paradas automáticas...`);
      await generateAutomaticStops(routeId, coordinates);
      return;
    }
    
    // Crear paradas basadas en las características del GeoJSON
    let stopCount = 0;
    let terminalCount = 0;
    
    // Terminal origen (primera parada)
    if (stopsGeoJSON.features.length > 0) {
      const firstStop = stopsGeoJSON.features[0];
      const firstCoord = firstStop.geometry.coordinates;
      
      await storage.createStop({
        routeId: routeId,
        name: `Terminal Origen (R${routeId})`,
        latitude: firstCoord[1].toString(),
        longitude: firstCoord[0].toString(),
        isTerminal: true,
        terminalType: 'first'
      });
      
      stopCount++;
      terminalCount++;
    }
    
    // Paradas intermedias
    for (let i = 1; i < stopsGeoJSON.features.length - 1; i++) {
      const stop = stopsGeoJSON.features[i];
      const stopCoord = stop.geometry.coordinates;
      
      await storage.createStop({
        routeId: routeId,
        name: `Parada ${i}`,
        latitude: stopCoord[1].toString(),
        longitude: stopCoord[0].toString(),
        isTerminal: false,
        terminalType: ''
      });
      
      stopCount++;
    }
    
    // Terminal destino (última parada)
    if (stopsGeoJSON.features.length > 1) {
      const lastStop = stopsGeoJSON.features[stopsGeoJSON.features.length - 1];
      const lastCoord = lastStop.geometry.coordinates;
      
      await storage.createStop({
        routeId: routeId,
        name: `Terminal Destino (R${routeId})`,
        latitude: lastCoord[1].toString(),
        longitude: lastCoord[0].toString(),
        isTerminal: true,
        terminalType: 'last'
      });
      
      stopCount++;
      terminalCount++;
    }
    
    console.log(`Importadas ${stopCount} paradas (${terminalCount} terminales) para la ruta ${routeId}`);
  } catch (error) {
    console.error(`Error importando paradas para ruta ${routeId}:`, error);
    // Si hay error, generar paradas automáticas
    console.log(`Intentando generar paradas automáticas como respaldo...`);
    await generateAutomaticStops(routeId, coordinates);
  }
}

// Función para generar paradas automáticas
async function generateAutomaticStops(routeId: number, coordinates: [number, number][]) {
  console.log(`Generando paradas automáticas para ruta ${routeId}...`);
  
  try {
    if (!coordinates || coordinates.length < 2) {
      console.log(`No hay suficientes coordenadas para generar paradas automáticas`);
      return;
    }
    
    // Determinar cuántas paradas generar (basado en longitud de la ruta)
    const totalStops = Math.min(
      Math.max(5, Math.floor(coordinates.length / 50)),
      20 // máximo 20 paradas
    );
    
    console.log(`Generando ${totalStops} paradas automáticas...`);
    
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
    
    // Distribución de paradas a lo largo de la ruta
    const interval = Math.floor(coordinates.length / (totalStops - 1));
    
    // Paradas intermedias
    for (let i = 1; i < totalStops - 1; i++) {
      const index = i * interval;
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
    
    console.log(`Generadas ${totalStops} paradas automáticas para ruta ${routeId}`);
  } catch (error) {
    console.error(`Error generando paradas automáticas para ruta ${routeId}:`, error);
  }
}

// Función para buscar archivos con extensión específica
function findFiles(dir: string, extension: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  
  const files: string[] = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const itemPath = path.join(dir, item);
    
    if (fs.statSync(itemPath).isDirectory()) {
      files.push(...findFiles(itemPath, extension));
    } else if (itemPath.endsWith(extension)) {
      files.push(itemPath);
    }
  }
  
  return files;
}

// Función para convertir shapefile a GeoJSON usando ogr2ogr
async function convertShapefileToGeoJSON(shapefilePath: string, outputPath: string): Promise<void> {
  try {
    await execAsync(`ogr2ogr -f GeoJSON "${outputPath}" "${shapefilePath}"`);
    console.log(`Convertido shapefile a GeoJSON: ${outputPath}`);
  } catch (error) {
    console.error(`Error convirtiendo shapefile a GeoJSON:`, error);
    throw error;
  }
}

// Función para determinar la zona en base a propiedades
function determineZone(properties: any): string {
  if (!properties) {
    return 'centro';
  }
  
  // Intentar extraer información de zona de las propiedades
  const desc = properties.desc || properties.description || properties.name || '';
  const descLower = desc.toLowerCase();
  
  if (descLower.includes('norte')) {
    return 'norte';
  } else if (descLower.includes('sur')) {
    return 'sur';
  } else if (descLower.includes('este') || descLower.includes('oriente')) {
    return 'este';
  } else if (descLower.includes('oeste') || descLower.includes('poniente')) {
    return 'oeste';
  } else {
    // Si no hay información clara, determinar basado en ID
    const id = properties.id || properties.ID || 0;
    const idNum = typeof id === 'string' ? parseInt(id, 10) : id;
    
    // Asignar zona basada en rangos de ID
    if (idNum < 20) {
      return 'centro';
    } else if (idNum < 40) {
      return 'norte';
    } else if (idNum < 60) {
      return 'sur';
    } else if (idNum < 80) {
      return 'este';
    } else {
      return 'oeste';
    }
  }
}

// Función para generar nombre corto a partir del nombre
function generateShortName(routeName: string): string {
  // Extraer número de ruta del nombre
  const matches = routeName.match(/\d+/);
  if (matches && matches.length > 0) {
    return `R${matches[0]}`;
  }
  
  // Si no hay número, usar primeras letras
  const words = routeName.split(' ');
  if (words.length > 1) {
    return words.map(w => w.charAt(0)).join('').toUpperCase();
  }
  
  return routeName.substring(0, 3).toUpperCase();
}

// Función para generar tiempo aproximado
function generateApproximateTime(coordinatesLength: number): string {
  // Estimar tiempo basado en la cantidad de puntos (longitud)
  const minTime = Math.max(10, Math.floor(coordinatesLength / 50));
  const maxTime = minTime + Math.floor(Math.random() * 10);
  
  return `${minTime}-${maxTime} minutos`;
}

// Función para generar frecuencia
function generateFrequency(): string {
  const minutes = Math.floor(Math.random() * 10 + 5);
  return `${minutes} minutos`;
}

// Ejecutar la importación
async function main() {
  try {
    await importRoutes();
    console.log('Proceso de importación completado con éxito');
    process.exit(0);
  } catch (error) {
    console.error('Error fatal en el proceso de importación:', error);
    process.exit(1);
  }
}

main();