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
const SHAPEFILES_DIR = './tmp/extracted/shapefiles-mapton-ciudadano';
const PROCESSED_DIR = './tmp/processed';
const BATCH_SIZE = 10; // Procesar 10 rutas por lote

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

// Controlar el lote a procesar mediante argumentos de línea de comandos
const args = process.argv.slice(2);
const batchArg = args.find(arg => arg.startsWith('--batch='));
const batchNum = batchArg ? parseInt(batchArg.split('=')[1], 10) : 1;

// Función principal para importar rutas en lotes
async function importRouteZipsByBatch() {
  console.log(`Iniciando importación de rutas - Lote ${batchNum}...`);
  
  try {
    // Encontrar todos los archivos route.zip recursivamente
    const routeZips = findAllRouteZips(SHAPEFILES_DIR);
    const totalZips = routeZips.length;
    const totalBatches = Math.ceil(totalZips / BATCH_SIZE);
    
    console.log(`Encontrados ${totalZips} archivos route.zip (${totalBatches} lotes totales)`);
    
    // Calcular el índice inicial y final para el lote actual
    const startIndex = (batchNum - 1) * BATCH_SIZE;
    const endIndex = Math.min(startIndex + BATCH_SIZE, totalZips);
    
    // Comprobar que haya archivos para procesar
    if (startIndex >= totalZips) {
      console.log(`⚠️ El lote ${batchNum} está fuera de rango (máximo: ${totalBatches})`);
      return { successCount: 0, errorCount: 0 };
    }
    
    // Seleccionar solo los archivos para este lote
    const batchZips = routeZips.slice(startIndex, endIndex);
    
    console.log(`Procesando lote ${batchNum}/${totalBatches}: ${batchZips.length} archivos (${startIndex+1}-${endIndex})`);
    
    // Si es el primer lote, limpiar la base de datos
    if (batchNum === 1) {
      console.log('Limpiando base de datos antes de importar...');
      await db.delete(busStops);
      await db.delete(busRoutes);
    } else {
      console.log('Continuando importación sin limpiar base de datos...');
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    // Procesar cada archivo route.zip de este lote
    for (let i = 0; i < batchZips.length; i++) {
      const zipPath = batchZips[i];
      const globalIndex = startIndex + i;
      
      try {
        console.log(`\nProcesando archivo ${globalIndex+1}/${totalZips}: ${zipPath}`);
        
        // Extraer información de la ruta
        const routeInfo = extractRouteInfo(zipPath);
        const { routeId, routeName, folderName } = routeInfo;
        
        // Determinar zona basada en el ID
        const zone = determineZone(routeId);
        
        console.log(`Ruta identificada: ID=${routeId}, Nombre=${routeName}, Zona=${zone}`);
        
        // Procesar el archivo ZIP
        const route = await processRouteZip(zipPath, routeId, routeName, zone);
        
        if (route) {
          console.log(`✅ Ruta importada: ${routeName} (ID DB: ${route.id})`);
          successCount++;
        } else {
          console.log(`❌ No se pudo importar la ruta: ${routeName}`);
          errorCount++;
        }
      } catch (error) {
        console.error(`❌ Error procesando ${zipPath}:`, error);
        errorCount++;
      }
    }
    
    console.log(`\n=== Lote ${batchNum}/${totalBatches} completado ===`);
    console.log(`Resultados: ${successCount} rutas importadas, ${errorCount} errores`);
    
    return { successCount, errorCount, totalBatches };
  } catch (error) {
    console.error('Error general en la importación:', error);
    throw error;
  }
}

// Función para encontrar todos los archivos route.zip
function findAllRouteZips(baseDir: string): string[] {
  const results: string[] = [];
  
  function searchDirectory(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        searchDirectory(fullPath);
      } else if (entry.name === 'route.zip') {
        results.push(fullPath);
      }
    }
  }
  
  // Iniciar búsqueda
  searchDirectory(baseDir);
  return results;
}

// Función para extraer información de la ruta basada en la ruta del archivo
function extractRouteInfo(zipPath: string): { routeId: number; routeName: string; folderName: string } {
  // Ejemplo de ruta: tmp/extracted/shapefiles-mapton-ciudadano/26_circuito/route.zip
  // o: tmp/extracted/shapefiles-mapton-ciudadano/10_circuito_alterno/ida/route.zip
  
  const parts = zipPath.split('/');
  let folderName = '';
  let routeId = 0;
  
  // Buscar el patrón de nombre de carpeta (Ej: "26_circuito" o "10_circuito_alterno")
  for (const part of parts) {
    if (part.includes('_circuito') || part.includes('_ruta')) {
      folderName = part;
      const idPart = part.split('_')[0];
      routeId = parseInt(idPart, 10);
      break;
    }
  }
  
  // Si no encontramos el patrón, usar un ID genérico
  if (routeId === 0) {
    routeId = Math.floor(Math.random() * 1000) + 200; // ID único aleatorio entre 200-1200
  }
  
  // Determinar si es ida, vuelta o directo
  let routeType = '';
  if (zipPath.includes('/ida/')) {
    routeType = ' (Ida)';
  } else if (zipPath.includes('/vuelta/')) {
    routeType = ' (Vuelta)';
  }
  
  const routeName = `Ruta ${routeId}${routeType}`;
  
  return { routeId, routeName, folderName };
}

// Función para determinar zona basada en ID
function determineZone(routeId: number): string {
  if (routeId < 20) return 'centro';
  if (routeId < 40) return 'norte';
  if (routeId < 60) return 'sur';
  if (routeId < 80) return 'este';
  return 'oeste';
}

// Función para procesar un archivo route.zip
async function processRouteZip(
  zipPath: string,
  routeId: number,
  routeName: string,
  zone: string
): Promise<any> {
  try {
    // Crear directorio temporal para extracción
    const tmpDir = path.join(PROCESSED_DIR, `route_${routeId}_${Date.now()}`);
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    
    // Extraer el ZIP
    await execAsync(`unzip -o "${zipPath}" -d "${tmpDir}"`);
    
    // Buscar archivo .shp
    const shpFiles = findFiles(tmpDir, '.shp');
    if (shpFiles.length === 0) {
      throw new Error('No se encontraron archivos .shp');
    }
    
    // Convertir a GeoJSON
    const geoJsonPath = path.join(tmpDir, 'route.geojson');
    await execAsync(`ogr2ogr -f GeoJSON "${geoJsonPath}" "${shpFiles[0]}"`);
    
    if (!fs.existsSync(geoJsonPath)) {
      throw new Error('Error al convertir shapefile a GeoJSON');
    }
    
    // Leer GeoJSON
    const geoJson = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));
    if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
      throw new Error('GeoJSON inválido o vacío');
    }
    
    // Extraer primera característica
    const feature = geoJson.features[0];
    const coordinates = feature.geometry?.coordinates || [];
    
    if (!coordinates || coordinates.length === 0) {
      throw new Error('No se encontraron coordenadas');
    }
    
    // Generar nombre corto y determinar color
    const shortName = `R${routeId}`;
    const color = zoneColors[zone];
    
    // Crear objeto GeoJSON para la ruta
    const routeGeoJSON = {
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
    
    // Crear ruta en la base de datos
    const route = await storage.createRoute({
      name: routeName,
      shortName: shortName,
      color: color,
      frequency: '10 minutos',
      scheduleStart: '05:30 AM',
      scheduleEnd: '22:30 PM',
      stopsCount: 0,
      approximateTime: '30 minutos',
      zone: zone,
      popular: true,
      geoJSON: routeGeoJSON
    });
    
    return route;
  } catch (error) {
    console.error(`Error procesando ZIP ${zipPath}:`, error);
    return null;
  }
}

// Función auxiliar para buscar archivos
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
    } else if (entry.name.toLowerCase().endsWith(extension.toLowerCase())) {
      results.push(fullPath);
    }
  }
  
  return results;
}

// Ejecutar
async function main() {
  try {
    const result = await importRouteZipsByBatch();
    console.log('Importación del lote finalizada con éxito:', result);
    
    if (result.totalBatches && batchNum < result.totalBatches) {
      console.log(`\nPara continuar con el siguiente lote, ejecutar:\nNODE_ENV=development tsx scripts/import-route-zips-batch.ts --batch=${batchNum + 1}`);
    } else {
      console.log('\n¡Todos los lotes han sido procesados!');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error fatal:', error);
    process.exit(1);
  }
}

main();