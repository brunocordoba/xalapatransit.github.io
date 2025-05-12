import * as fs from 'fs';
import * as path from 'path';
import * as AdmZip from 'adm-zip';
import { pool } from '../server/db';
import { busStops, busRoutes } from '../shared/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';

const db = drizzle(pool);

// Función para encontrar todos los archivos .zip en un directorio y sus subdirectorios
function findZipFiles(dir: string): string[] {
  let results: string[] = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const itemPath = path.join(dir, item);
    const stat = fs.statSync(itemPath);
    
    if (stat.isDirectory()) {
      results = results.concat(findZipFiles(itemPath));
    } else if (item.toLowerCase() === 'stops.zip' || item.toLowerCase() === 'stop.zip') {
      results.push(itemPath);
    }
  }
  
  return results;
}

// Función para extraer información de la ruta a partir del nombre del archivo
function extractRouteInfo(zipPath: string, manualRouteId?: number): { routeId: number; routeName: string; } | null {
  try {
    // Si hay un ID manual, lo usamos directamente
    if (manualRouteId) {
      return { routeId: manualRouteId, routeName: `Ruta ${manualRouteId}` };
    }
    
    // Ejemplo de ruta: /tmp/mapaton-extract/shapefiles-mapton-ciudadano/1_circuito/stops.zip
    const parts = zipPath.split('/');
    
    // Buscar la parte que contiene "_circuito"
    let circuitoPart = '';
    for (const part of parts) {
      if (part.includes('_circuito')) {
        circuitoPart = part;
        break;
      }
    }
    
    if (!circuitoPart) {
      console.warn(`No se pudo extraer información de ruta de: ${zipPath}`);
      return null;
    }
    
    // Extraer el número de ruta
    const routeMatch = circuitoPart.match(/^(\d+)_/);
    if (!routeMatch) {
      console.warn(`No se pudo extraer número de ruta de: ${circuitoPart}`);
      return null;
    }
    
    const routeNumber = parseInt(routeMatch[1], 10);
    
    return {
      routeId: routeNumber,
      routeName: `Ruta ${routeNumber}`
    };
  } catch (error) {
    console.error(`Error al extraer información de ruta: ${error}`);
    return null;
  }
}

// Función para procesar un archivo stops.zip y añadir las paradas a la base de datos
async function processStopsFromZip(zipPath: string, manualRouteId?: number): Promise<boolean> {
  try {
    console.log(`Procesando paradas desde: ${zipPath}`);
    
    // Extraer información de la ruta
    const routeInfo = extractRouteInfo(zipPath, manualRouteId);
    if (!routeInfo) {
      console.warn(`No se pudo extraer información de ruta para: ${zipPath}`);
      return false;
    }
    
    console.log(`Información de ruta extraída: ID ${routeInfo.routeId}, Nombre: ${routeInfo.routeName}`);
    
    // Buscar el ID de la ruta en la base de datos
    const routes = await db.select().from(busRoutes).where(eq(busRoutes.id, routeInfo.routeId));
    
    if (routes.length === 0) {
      console.warn(`No se encontró la ruta con ID ${routeInfo.routeId} en la base de datos`);
      
      // Buscar rutas que contengan el número en su nombre usando SQL directo
      const alternativeRoutesQuery = await db.execute(
        sql`SELECT * FROM bus_routes WHERE LOWER(name) LIKE ${'%ruta ' + routeInfo.routeId + '%'}`
      );
      
      // Los resultados de db.execute no tienen length, pero podemos checar rowCount
      if (alternativeRoutesQuery.rowCount && alternativeRoutesQuery.rowCount > 0) {
        console.log(`Se encontraron ${alternativeRoutesQuery.rowCount} rutas alternativas por nombre:`);
        
        // Las filas están en la propiedad rows
        alternativeRoutesQuery.rows.forEach(route => {
          console.log(`- ID: ${route.id}, Nombre: ${route.name}`);
        });
        
        return false;
      }
      
      return false;
    }
    
    const route = routes[0];
    console.log(`Ruta encontrada en la base de datos: ID ${route.id}, Nombre: ${route.name}`);
    
    // Verificar si ya existen paradas para esta ruta
    const existingStops = await db.select().from(busStops).where(eq(busStops.routeId, route.id));
    if (existingStops.length > 0) {
      console.log(`La ruta ${route.id} (${route.name}) ya tiene ${existingStops.length} paradas, saltando...`);
      return true;
    }
    
    // Leer y extraer el archivo stops.zip
    const zip = new AdmZip(zipPath);
    
    // Buscar el archivo .shp dentro del zip
    const shpEntry = zip.getEntries().find(entry => entry.name.toLowerCase().endsWith('.shp'));
    if (!shpEntry) {
      console.warn(`No se encontró archivo .shp en ${zipPath}`);
      return false;
    }
    
    // Extraer todos los archivos a un directorio temporal
    const tempDir = path.join('tmp', `stops_${route.id}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    zip.extractAllTo(tempDir, true);
    
    // Encontrar el archivo .shp extraído
    const shpFiles = fs.readdirSync(tempDir).filter(file => file.toLowerCase().endsWith('.shp'));
    if (shpFiles.length === 0) {
      console.warn(`No se encontraron archivos .shp extraídos en ${tempDir}`);
      return false;
    }
    
    const shpFile = path.join(tempDir, shpFiles[0]);
    
    // Crear un directorio para el archivo GeoJSON
    const geojsonFile = path.join(tempDir, 'stops.geojson');
    
    // Convertir el archivo shapefile a GeoJSON usando ogr2ogr
    await new Promise<void>((resolve, reject) => {
      const { spawn } = require('child_process');
      
      console.log(`Convirtiendo shapefile a GeoJSON: ${shpFile} -> ${geojsonFile}`);
      
      const process = spawn('ogr2ogr', [
        '-f', 'GeoJSON',
        geojsonFile,
        shpFile
      ]);
      
      process.on('close', (code: number) => {
        if (code !== 0) {
          console.error(`ogr2ogr terminó con código ${code}`);
          reject(new Error(`ogr2ogr falló con código ${code}`));
        } else {
          console.log('Conversión completada con éxito');
          resolve();
        }
      });
    });
    
    // Leer el archivo GeoJSON
    if (!fs.existsSync(geojsonFile)) {
      console.warn(`El archivo GeoJSON no se creó correctamente: ${geojsonFile}`);
      return false;
    }
    
    const geojsonContent = fs.readFileSync(geojsonFile, 'utf8');
    const geojson = JSON.parse(geojsonContent);
    
    if (!geojson.features || !Array.isArray(geojson.features)) {
      console.warn(`El archivo GeoJSON no contiene features: ${geojsonFile}`);
      return false;
    }
    
    console.log(`Se encontraron ${geojson.features.length} paradas en el GeoJSON`);
    
    // Procesar cada parada y añadirla a la base de datos
    let stopsAdded = 0;
    
    for (let i = 0; i < geojson.features.length; i++) {
      const feature = geojson.features[i];
      
      if (!feature.geometry || !feature.geometry.coordinates) {
        console.warn(`Feature sin coordenadas en el índice ${i}`);
        continue;
      }
      
      const coordinates = feature.geometry.coordinates;
      
      // Determinar el nombre de la parada
      let stopName = `Parada ${route.id}-${i+1}`;
      
      // Si hay propiedad name o NAME en las propiedades, usarla
      if (feature.properties) {
        if (feature.properties.name) {
          stopName = feature.properties.name;
        } else if (feature.properties.NAME) {
          stopName = feature.properties.NAME;
        } else if (feature.properties.Name) {
          stopName = feature.properties.Name;
        }
      }
      
      // Determinar si es terminal
      const isTerminal = i === 0 || i === geojson.features.length - 1;
      const terminalType = i === 0 ? 'inicio' : (i === geojson.features.length - 1 ? 'fin' : '');
      
      // Añadir la parada a la base de datos
      try {
        await db.insert(busStops).values({
          routeId: route.id,
          name: stopName,
          latitude: coordinates[1].toString(),
          longitude: coordinates[0].toString(),
          isTerminal,
          terminalType
        });
        
        stopsAdded++;
      } catch (error) {
        console.error(`Error al insertar parada ${stopName}: ${error}`);
      }
    }
    
    console.log(`Se añadieron ${stopsAdded} paradas para la ruta ${route.id} (${route.name})`);
    
    // Limpiar archivos temporales
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`No se pudieron eliminar los archivos temporales: ${error}`);
    }
    
    return true;
  } catch (error) {
    console.error(`Error al procesar paradas desde ${zipPath}: ${error}`);
    return false;
  }
}

// Función principal para importar todas las paradas
async function importAllStopsFromZips(baseDir: string) {
  try {
    console.log(`Buscando archivos stops.zip en ${baseDir}...`);
    
    // Encontrar todos los archivos stops.zip
    const stopZipFiles = findZipFiles(baseDir);
    
    console.log(`Se encontraron ${stopZipFiles.length} archivos stops.zip`);
    
    let processed = 0;
    let successful = 0;
    
    // Procesar cada archivo
    for (const zipFile of stopZipFiles) {
      console.log(`\nProcesando ${processed + 1}/${stopZipFiles.length}: ${zipFile}`);
      
      const success = await processStopsFromZip(zipFile);
      
      processed++;
      if (success) {
        successful++;
      }
      
      // Pequeña pausa para no sobrecargar la base de datos
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`\nProceso completado: ${successful}/${processed} archivos procesados con éxito`);
  } catch (error) {
    console.error(`Error en importAllStopsFromZips: ${error}`);
  }
}

// Función para importar paradas desde un archivo específico
async function importStopsFromSpecific(pathToProcess: string, manualRouteId?: number) {
  try {
    console.log(`Procesando archivo específico: ${pathToProcess}`);
    
    const success = await processStopsFromZip(pathToProcess, manualRouteId);
    
    if (success) {
      console.log('Importación completada con éxito');
    } else {
      console.log('Importación fallida');
    }
  } catch (error) {
    console.error(`Error en importStopsFromSpecific: ${error}`);
  }
}

// Función principal
async function main() {
  try {
    // Comprobar los argumentos de la línea de comandos
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      // Sin argumentos, importar todas las paradas
      await importAllStopsFromZips('tmp/mapaton-extract');
    } else if (args.length === 1) {
      // Un argumento, importar desde una ruta específica
      await importStopsFromSpecific(args[0]);
    } else if (args.length === 2) {
      // Dos argumentos, importar desde una ruta específica con ID manual
      await importStopsFromSpecific(args[0], parseInt(args[1], 10));
    } else {
      console.error('Uso: npm run stops [path_to_stops_zip] [manual_route_id]');
      process.exit(1);
    }
    
    process.exit(0);
  } catch (error) {
    console.error(`Error en main: ${error}`);
    process.exit(1);
  }
}

// Ejecutar el programa
main();