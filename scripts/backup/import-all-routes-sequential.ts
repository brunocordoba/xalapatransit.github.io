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

// Tipo para la información de ruta
interface RouteInfo {
  id: number;
  folder: string;
  path: string;
  type: 'direct' | 'ida' | 'vuelta';
}

// Encuentra todas las carpetas de rutas y las organiza
function findAllRouteFolders(): RouteInfo[] {
  console.log('Buscando carpetas de rutas...');
  
  // Leer todas las carpetas en el directorio principal
  const entries = fs.readdirSync(SHAPEFILES_DIR, { withFileTypes: true });
  
  // Filtrar solo directorios que siguen el patrón de nombre
  const routeFolders = entries
    .filter(entry => entry.isDirectory())
    .filter(entry => entry.name.includes('_circuito') || entry.name.includes('_ruta'))
    .map(entry => {
      const folderPath = path.join(SHAPEFILES_DIR, entry.name);
      const idMatch = entry.name.match(/^(\d+)_/);
      const id = idMatch ? parseInt(idMatch[1], 10) : 0;
      
      return {
        id,
        folder: entry.name,
        path: folderPath
      };
    })
    .filter(info => info.id > 0); // Solo carpetas con ID válido
  
  // Ordenar por ID (para mantener el orden original)
  routeFolders.sort((a, b) => a.id - b.id);
  
  // Expandir carpetas de rutas para incluir ida/vuelta si existen
  const routeInfos: RouteInfo[] = [];
  
  for (const folder of routeFolders) {
    const hasIda = fs.existsSync(path.join(folder.path, 'ida', 'route.zip'));
    const hasVuelta = fs.existsSync(path.join(folder.path, 'vuelta', 'route.zip'));
    const hasDirect = fs.existsSync(path.join(folder.path, 'route.zip'));
    
    if (hasIda) {
      routeInfos.push({
        id: folder.id,
        folder: folder.folder,
        path: path.join(folder.path, 'ida', 'route.zip'),
        type: 'ida'
      });
    }
    
    if (hasVuelta) {
      routeInfos.push({
        id: folder.id,
        folder: folder.folder,
        path: path.join(folder.path, 'vuelta', 'route.zip'),
        type: 'vuelta'
      });
    }
    
    if (hasDirect) {
      routeInfos.push({
        id: folder.id,
        folder: folder.folder,
        path: path.join(folder.path, 'route.zip'),
        type: 'direct'
      });
    }
  }
  
  console.log(`Encontradas ${routeInfos.length} rutas en ${routeFolders.length} carpetas`);
  return routeInfos;
}

// Función principal para importar todas las rutas en orden
async function importAllRoutesSequential() {
  console.log('Iniciando importación secuencial de todas las rutas...');
  
  try {
    // Limpiar la base de datos antes de importar
    console.log('Limpiando base de datos...');
    await db.delete(busStops);
    await db.delete(busRoutes);
    
    // Obtener todas las carpetas de rutas
    const routeInfos = findAllRouteFolders();
    
    console.log(`Procesando ${routeInfos.length} rutas en orden secuencial`);
    
    let successCount = 0;
    let errorCount = 0;
    
    // Procesar cada ruta en orden
    for (let i = 0; i < routeInfos.length; i++) {
      const routeInfo = routeInfos[i];
      
      try {
        console.log(`\nProcesando ruta ${i+1}/${routeInfos.length}: ID=${routeInfo.id}, Tipo=${routeInfo.type}`);
        
        // Determinar zona basada en el ID
        const zone = determineZone(routeInfo.id);
        
        // Determinar nombre de ruta
        const suffix = routeInfo.type === 'direct' ? '' : 
                      (routeInfo.type === 'ida' ? ' (Ida)' : ' (Vuelta)');
        const routeName = `Ruta ${routeInfo.id}${suffix}`;
        
        console.log(`Importando: ${routeName} (Zona: ${zone})`);
        
        // Procesar la ruta
        const route = await processRouteZip(
          routeInfo.path,
          routeInfo.id, 
          routeName,
          zone,
          i+1 // Secuencial del 1 al N
        );
        
        if (route) {
          console.log(`✅ Ruta importada: ${routeName} (ID DB: ${route.id}, Secuencia: ${i+1})`);
          successCount++;
        } else {
          console.log(`❌ Error al importar: ${routeName}`);
          errorCount++;
        }
      } catch (error) {
        console.error(`❌ Error procesando ruta ${routeInfo.id}:`, error);
        errorCount++;
      }
    }
    
    console.log(`\n=== Importación completada ===`);
    console.log(`Total: ${successCount} rutas importadas, ${errorCount} errores`);
    
    return { successCount, errorCount };
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
    
    // Crear ruta en la base de datos - Nombres basados en número secuencial
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
    const result = await importAllRoutesSequential();
    console.log('Importación finalizada con éxito:', result);
    process.exit(0);
  } catch (error) {
    console.error('Error fatal:', error);
    process.exit(1);
  }
}

main();