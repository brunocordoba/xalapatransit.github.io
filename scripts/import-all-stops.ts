import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { promisify } from 'util';
import { pool } from '../server/db';
import { busStops, busRoutes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as shapefile from 'shapefile';
import gdal from 'gdal-async';
const db = drizzle(pool);

// Usar import.meta.url para obtener la ruta del directorio actual
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ruta base donde se extraerá el ZIP principal
const BASE_DIR = path.join(__dirname, '..', 'tmp', 'mapaton-extract');
// Archivo ZIP principal
const MAIN_ZIP = path.join(__dirname, '..', 'attached_assets', 'shapefiles-mapaton-ciudadano.zip');

// Función para encontrar todos los archivos stops.zip
function findAllStopsZips(baseDir: string): string[] {
  const stopsZips: string[] = [];
  
  function searchDirectory(dir: string) {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const itemPath = path.join(dir, item);
      const stats = fs.statSync(itemPath);
      
      if (stats.isDirectory()) {
        // Si es un directorio, buscar recursivamente
        searchDirectory(itemPath);
      } else if (item === 'stops.zip') {
        // Si es un archivo stops.zip, añadirlo a la lista
        stopsZips.push(itemPath);
      }
    }
  }
  
  searchDirectory(baseDir);
  return stopsZips;
}

// Función para extraer el ID de ruta del path
function extractRouteInfo(zipPath: string): { routeId: number; routeName: string } | null {
  try {
    // Ejemplo de ruta: tmp/mapaton-extract/shapefiles-mapton-ciudadano/11_circuito/stops.zip
    // O para rutas con dirección: tmp/mapaton-extract/shapefiles-mapton-ciudadano/17_circuito/ida/stops.zip
    const pathParts = zipPath.split('/');
    
    // Verificar si es una ruta con dirección (ida/vuelta)
    const isDirectional = pathParts[pathParts.length - 3]?.includes('_') && 
                          ['ida', 'vuelta'].includes(pathParts[pathParts.length - 2]);
    
    let folderName, direction;
    
    if (isDirectional) {
      folderName = pathParts[pathParts.length - 3]; // ej: 17_circuito
      direction = pathParts[pathParts.length - 2];  // ida o vuelta
    } else {
      folderName = pathParts[pathParts.length - 2]; // ej: 11_circuito
      direction = '';
    }
    
    // Extraer el número de ruta del nombre de la carpeta
    const match = folderName.match(/^(\d+)_/);
    if (match && match[1]) {
      const routeNumber = parseInt(match[1], 10);
      
      // Para rutas con dirección, debemos ajustar el ID
      // Las rutas de ida/vuelta en nuestra base siguen un patrón específico
      let routeId;
      if (direction) {
        // Buscamos la ruta base y determinamos el offset para ida o vuelta
        const baseId = 344 + routeNumber;
        
        // Si es vuelta, incrementar en 1 el ID (siguiendo el patrón de nuestra DB)
        if (direction === 'vuelta') {
          routeId = baseId + 1;
        } else {
          routeId = baseId;
        }
      } else {
        // Ruta normal, sin dirección
        routeId = 344 + routeNumber;
      }
      
      const routeName = folderName.replace(/^\d+_/, '').replace(/_/g, ' ');
      return { routeId, routeName };
    }
    
    return null;
  } catch (error) {
    console.error(`Error al extraer información de ruta de ${zipPath}:`, error);
    return null;
  }
}

// Función para procesar un archivo de paradas
async function processStopsZip(zipPath: string): Promise<boolean> {
  try {
    // Extraer información de la ruta
    const routeInfo = extractRouteInfo(zipPath);
    if (!routeInfo) {
      console.warn(`No se pudo extraer información de ruta de ${zipPath}`);
      return false;
    }
    
    const { routeId } = routeInfo;
    
    // Verificar si la ruta existe en la base de datos
    const existingRoutes = await db.select()
      .from(busRoutes)
      .where(eq(busRoutes.id, routeId));
    
    if (existingRoutes.length === 0) {
      console.warn(`La ruta con ID ${routeId} no existe en la base de datos. Omitiendo importación de paradas.`);
      return false;
    }
    
    const extractDir = path.join(path.dirname(zipPath), 'stops-extract');
    if (!fs.existsSync(extractDir)) {
      fs.mkdirSync(extractDir, { recursive: true });
    }
    
    // Extraer el archivo ZIP
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);
    
    // Buscar archivos .shp
    const shpFiles = fs.readdirSync(extractDir)
      .filter(file => file.endsWith('.shp'))
      .map(file => path.join(extractDir, file));
    
    if (shpFiles.length === 0) {
      console.warn(`No se encontraron archivos .shp en ${extractDir}`);
      return false;
    }
    
    // Procesar cada archivo shapefile
    for (const shpFile of shpFiles) {
      try {
        // Leer el shapefile usando la biblioteca shapefile
        const source = await shapefile.open(shpFile);
        const geoJsonFeatures = [];
        
        // Extraer todas las características (features)
        let feature;
        while ((feature = await source.read()) !== null) {
          geoJsonFeatures.push(feature);
        }
        
        console.log(`Leídas ${geoJsonFeatures.length} paradas del shapefile ${path.basename(shpFile)}`);
        
        // Importar cada parada a la base de datos
        let importedCount = 0;
        for (let i = 0; i < geoJsonFeatures.length; i++) {
          const feature = geoJsonFeatures[i];
          const geometry = feature.geometry;
          
          if (geometry.type !== 'Point') {
            console.warn(`Geometría no soportada: ${geometry.type}. Esperaba 'Point'`);
            continue;
          }
          
          // Obtener coordenadas
          const coordinates = geometry.coordinates;
          const longitude = coordinates[0].toString();
          const latitude = coordinates[1].toString();
          
          // Obtener propiedades
          const properties = feature.properties || {};
          const sequence = properties.sequence || i;
          
          // Generar nombre de parada
          const stopName = properties.name || `Parada ${routeId}-${sequence}`;
          
          // Comprobar si la parada ya existe
          const existingStops = await db.select().from(busStops).where(eq(busStops.routeId, routeId));
          const existingStop = existingStops.find(stop => 
            stop.latitude === latitude && stop.longitude === longitude
          );
          
          if (existingStop) {
            console.log(`Parada en [${latitude}, ${longitude}] ya existe para la ruta ${routeId}`);
            continue;
          }
          
          // Insertar la parada en la base de datos
          const isTerminal = sequence === 0 || sequence === geoJsonFeatures.length - 1;
          const terminalType = isTerminal ? (sequence === 0 ? 'inicio' : 'fin') : '';
          
          await db.insert(busStops).values({
            routeId,
            name: stopName,
            latitude,
            longitude,
            isTerminal,
            terminalType
          });
          
          importedCount++;
          console.log(`Parada importada: ${stopName} [${latitude}, ${longitude}] para ruta ${routeId}`);
        }
        
        console.log(`Importadas ${importedCount} paradas para la ruta ${routeId}`);
        
        // Si no se pudieron importar paradas mediante shapefile, intentar con GDAL
        if (importedCount === 0) {
          console.log(`Intentando importar con GDAL para ${shpFile}`);
          
          try {
            // Usar GDAL para leer el shapefile
            const dataset = gdal.open(shpFile);
            const layer = dataset.layers.get(0);
            
            const featureCount = layer.features.count();
            console.log(`GDAL encontró ${featureCount} características en ${path.basename(shpFile)}`);
            
            let gdalImportedCount = 0;
            layer.features.forEach((feature, i) => {
              const geometry = feature.getGeometry();
              
              if (geometry.wkbType !== gdal.wkbPoint) {
                console.warn(`GDAL: Geometría no soportada: ${geometry.wkbType}. Esperaba punto.`);
                return;
              }
              
              const x = geometry.x;
              const y = geometry.y;
              
              const stopName = `Parada ${routeId}-${i}`;
              
              // Async operation inside sync forEach, use Promise.resolve
              Promise.resolve().then(async () => {
                // Comprobar si la parada ya existe
                const existingStops = await db.select().from(busStops).where(eq(busStops.routeId, routeId));
                const existingStop = existingStops.find(stop => 
                  stop.latitude === y.toString() && stop.longitude === x.toString()
                );
                
                if (existingStop) {
                  console.log(`GDAL: Parada en [${y}, ${x}] ya existe para la ruta ${routeId}`);
                  return;
                }
                
                // Insertar la parada en la base de datos
                const isTerminal = i === 0 || i === featureCount - 1;
                const terminalType = isTerminal ? (i === 0 ? 'inicio' : 'fin') : '';
                
                await db.insert(busStops).values({
                  routeId,
                  name: stopName,
                  latitude: y.toString(),
                  longitude: x.toString(),
                  isTerminal,
                  terminalType
                });
                
                gdalImportedCount++;
                console.log(`GDAL: Parada importada: ${stopName} [${y}, ${x}] para ruta ${routeId}`);
              });
            });
            
            console.log(`GDAL: Se procesaron ${gdalImportedCount} paradas para la ruta ${routeId}`);
            dataset.close();
          } catch (gdalError) {
            console.error(`Error al procesar con GDAL ${shpFile}:`, gdalError);
          }
        }
      } catch (error) {
        console.error(`Error al procesar ${shpFile}:`, error);
      }
    }
    
    return true;
  } catch (error) {
    console.error(`Error al procesar ${zipPath}:`, error);
    return false;
  }
}

// Función principal
async function importAllStops() {
  try {
    // Crear el directorio base si no existe
    if (!fs.existsSync(BASE_DIR)) {
      fs.mkdirSync(BASE_DIR, { recursive: true });
    }
    
    // Extraer el ZIP principal
    console.log(`Extrayendo ${MAIN_ZIP} a ${BASE_DIR}...`);
    const mainZip = new AdmZip(MAIN_ZIP);
    mainZip.extractAllTo(BASE_DIR, true);
    
    // Encontrar todos los archivos stops.zip
    const stopsZips = findAllStopsZips(BASE_DIR);
    console.log(`Se encontraron ${stopsZips.length} archivos stops.zip`);
    
    // Procesar cada archivo de paradas
    let successes = 0;
    let failures = 0;
    
    for (let i = 0; i < stopsZips.length; i++) {
      const zipPath = stopsZips[i];
      console.log(`Procesando archivo ${i + 1}/${stopsZips.length}: ${zipPath}`);
      
      const success = await processStopsZip(zipPath);
      if (success) {
        successes++;
      } else {
        failures++;
      }
    }
    
    console.log(`Importación completada. Éxitos: ${successes}, Fallos: ${failures}`);
  } catch (error) {
    console.error('Error en importAllStops:', error);
  }
}

// Ejecutar la función principal
importAllStops()
  .then(() => console.log('Proceso completado'))
  .catch(error => console.error('Error en el proceso principal:', error))
  .finally(() => process.exit(0));