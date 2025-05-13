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
const EXTRACT_DIR = '/tmp/extract';
const PROCESSED_DIR = './tmp/processed';
const BATCH_SIZE = 15; // Procesar 15 rutas por lote

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

// Tipo para la información de ruta
interface RouteInfo {
  id: number;
  path: string;
  name: string;
  type: 'direct' | 'ida' | 'vuelta';
}

// Encontrar todos los archivos route.zip de forma recursiva
function findAllRouteFiles(): RouteInfo[] {
  console.log('Buscando archivos route.zip...');
  
  // Comando para encontrar todos los archivos route.zip
  let routeFiles = findFiles(EXTRACT_DIR, 'route.zip');
  
  // Filtrar archivos de metadatos de macOS (._*)
  routeFiles = routeFiles.filter(file => {
    const parts = file.split('/');
    const filename = parts[parts.length - 1];
    return !filename.startsWith('._') && 
           !file.includes('/__MACOSX/') && 
           !file.includes('/.git/');
  });
  
  console.log(`Encontrados ${routeFiles.length} archivos route.zip válidos.`);
  
  // Mapear a objetos RouteInfo
  const routeInfos: RouteInfo[] = [];
  
  for (const filePath of routeFiles) {
    // Determinar nombre de la ruta y tipo (ida/vuelta/direct)
    const pathParts = filePath.split('/');
    const isIda = pathParts.includes('ida');
    const isVuelta = pathParts.includes('vuelta');
    
    // Extraer ID de la carpeta principal
    let routeId = 0;
    let routeName = 'Ruta desconocida';
    
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const match = part.match(/^(\d+)_/);
      if (match) {
        routeId = parseInt(match[1], 10);
        routeName = `Ruta ${routeId}`;
        break;
      }
    }
    
    if (routeId > 0) {
      const type = isIda ? 'ida' : (isVuelta ? 'vuelta' : 'direct');
      
      // Añadir sufijo al nombre si es ida/vuelta
      if (isIda) {
        routeName += ' (Ida)';
      } else if (isVuelta) {
        routeName += ' (Vuelta)';
      }
      
      routeInfos.push({
        id: routeId,
        path: filePath,
        name: routeName,
        type
      });
    }
  }
  
  // Ordenar por ID
  routeInfos.sort((a, b) => {
    // Primero ordenar por ID
    if (a.id !== b.id) {
      return a.id - b.id;
    }
    
    // Si tienen el mismo ID, ordenar por tipo: direct, ida, vuelta
    const typeOrder = { direct: 0, ida: 1, vuelta: 2 };
    return typeOrder[a.type] - typeOrder[b.type];
  });
  
  console.log(`Encontrados ${routeInfos.length} archivos route.zip.`);
  return routeInfos;
}

// Función principal para importar rutas por lotes
async function importAllRouteFiles() {
  console.log(`Iniciando importación de todos los archivos route.zip - Lote ${batchNum}...`);
  
  try {
    // Obtener todas las rutas
    const allRouteInfos = findAllRouteFiles();
    
    const totalRoutes = allRouteInfos.length;
    const totalBatches = Math.ceil(totalRoutes / BATCH_SIZE);
    
    console.log(`Total: ${totalRoutes} rutas (${totalBatches} lotes totales)`);
    
    // Calcular el índice inicial y final para el lote actual
    const startIndex = (batchNum - 1) * BATCH_SIZE;
    const endIndex = Math.min(startIndex + BATCH_SIZE, totalRoutes);
    
    // Comprobar que haya archivos para procesar
    if (startIndex >= totalRoutes) {
      console.log(`⚠️ El lote ${batchNum} está fuera de rango (máximo: ${totalBatches})`);
      return { successCount: 0, errorCount: 0, totalBatches };
    }
    
    // Seleccionar solo las rutas para este lote
    const batchRoutes = allRouteInfos.slice(startIndex, endIndex);
    
    console.log(`Procesando lote ${batchNum}/${totalBatches}: ${batchRoutes.length} rutas (${startIndex+1}-${endIndex})`);
    
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
    
    // Procesar cada ruta en este lote
    for (let i = 0; i < batchRoutes.length; i++) {
      const routeInfo = batchRoutes[i];
      const globalIndex = startIndex + i;
      
      try {
        console.log(`\nProcesando ruta ${globalIndex+1}/${totalRoutes}: ID=${routeInfo.id}, Nombre=${routeInfo.name}`);
        
        // Determinar zona basada en el ID
        const zone = determineZone(routeInfo.id);
        
        console.log(`Importando: ${routeInfo.name} (Zona: ${zone})`);
        
        // Procesar la ruta
        const route = await processRouteZip(
          routeInfo.path,
          routeInfo.id, 
          routeInfo.name,
          zone,
          globalIndex+1 // Numeración secuencial
        );
        
        if (route) {
          console.log(`✅ Ruta importada: ${routeInfo.name} (ID DB: ${route.id}, Secuencia: ${globalIndex+1})`);
          successCount++;
        } else {
          console.log(`❌ Error al importar: ${routeInfo.name}`);
          errorCount++;
        }
      } catch (error) {
        console.error(`❌ Error procesando ruta ${routeInfo.id}:`, error);
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
  zone: string,
  sequenceNumber: number
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
    
    // Crear ruta en la base de datos con nombre prefijado con número secuencial
    const route = await storage.createRoute({
      name: `${sequenceNumber}. ${routeName}`, // Prefijo secuencial para ordenar
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
    const result = await importAllRouteFiles();
    console.log('Importación del lote finalizada con éxito:', result);
    
    if (result.totalBatches && batchNum < result.totalBatches) {
      console.log(`\nPara continuar con el siguiente lote, ejecutar:\nNODE_ENV=development tsx scripts/import-all-route-files.ts --batch=${batchNum + 1}`);
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