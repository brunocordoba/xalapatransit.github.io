import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { pool } from '../server/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

// Inicializar base de datos
const db = drizzle(pool);

async function findAllRoutes() {
  try {
    console.log("Obteniendo todas las rutas de la base de datos...");
    const result = await db.execute(sql`SELECT id, name FROM bus_routes ORDER BY id`);
    console.log(`Se encontraron ${result.rowCount} rutas en la base de datos.`);
    return result.rows;
  } catch (error) {
    console.error("Error al obtener rutas:", error);
    return [];
  }
}

// Esta función encuentra todas las rutas y mapea los números de circuito a los IDs de rutas
async function findStopFiles() {
  const routes = await findAllRoutes();
  const routesMap = new Map();
  
  // Crear un mapeo de números de circuito a IDs de ruta
  for (const route of routes) {
    const routeName = route.name;
    const routeMatch = routeName.match(/Ruta\s+(\d+)(?:\s+\(|$)/i);
    
    if (routeMatch) {
      const circuitoNum = parseInt(routeMatch[1], 10);
      if (!routesMap.has(circuitoNum)) {
        routesMap.set(circuitoNum, []);
      }
      routesMap.get(circuitoNum).push({
        id: route.id,
        name: routeName
      });
    }
  }
  
  console.log(`Se crearon mapeos para ${routesMap.size} circuitos diferentes.`);
  
  // Encontrar archivos de paradas
  const files = [];
  const baseDir = 'tmp/mapaton-extract';
  
  function searchDir(dir: string) {
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          searchDir(fullPath);
        } else if (item.toLowerCase() === 'stops.zip') {
          // Extraer el número de circuito de la ruta del directorio
          const parts = fullPath.split('/');
          let circuitoNum = -1;
          let circuitoPath = '';
          
          for (const part of parts) {
            const match = part.match(/^(\d+)_/);
            if (match) {
              circuitoNum = parseInt(match[1], 10);
              circuitoPath = part;
              break;
            }
          }
          
          if (circuitoNum > 0 && routesMap.has(circuitoNum)) {
            files.push({
              path: fullPath,
              circuitoNum,
              circuitoPath,
              matchingRoutes: routesMap.get(circuitoNum)
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error al buscar en directorio ${dir}:`, error);
    }
  }
  
  searchDir(baseDir);
  console.log(`Se encontraron ${files.length} archivos de paradas con mapeo a rutas.`);
  
  return files;
}

// Procesa un archivo de paradas para una ruta específica
async function processStopFile(file: { path: string; circuitoNum: number; circuitoPath: string; matchingRoutes: any[] }) {
  try {
    console.log(`\nProcesando archivo ${file.path} para circuito ${file.circuitoNum}`);
    
    if (file.matchingRoutes.length === 0) {
      console.log(`No hay rutas mapeadas para el circuito ${file.circuitoNum}`);
      return false;
    }
    
    // Determinar qué ruta usar para las paradas
    // Si hay "ida" o "vuelta" en la ruta, usar la ruta correspondiente
    let routeToUse = file.matchingRoutes[0];
    const useIda = file.path.includes('/ida/');
    const useVuelta = file.path.includes('/vuelta/');
    
    if (useIda || useVuelta) {
      const direction = useIda ? 'Ida' : 'Vuelta';
      const directionRoute = file.matchingRoutes.find(r => r.name.includes(direction));
      if (directionRoute) {
        routeToUse = directionRoute;
      }
    }
    
    const routeId = routeToUse.id;
    const routeName = routeToUse.name;
    
    console.log(`Usando ruta: ${routeName} (ID: ${routeId})`);
    
    // Verificar si la ruta ya tiene paradas
    const existingStopsResult = await db.execute(
      sql`SELECT COUNT(*) as count FROM bus_stops WHERE route_id = ${routeId}`
    );
    
    const existingStopsCount = parseInt(existingStopsResult.rows[0].count);
    if (existingStopsCount > 0) {
      console.log(`La ruta ${routeId} ya tiene ${existingStopsCount} paradas, saltando...`);
      return true;
    }
    
    // Crear directorio temporal
    const tempDir = path.join('tmp', `stops_${routeId}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Extraer el archivo ZIP
    try {
      console.log(`Extrayendo ${file.path} a ${tempDir}...`);
      execSync(`unzip -o "${file.path}" -d "${tempDir}"`);
    } catch (error) {
      console.error(`Error al extraer archivo ZIP:`, error);
      return false;
    }
    
    // Encontrar shapefile
    const shpFiles = fs.readdirSync(tempDir).filter(f => f.toLowerCase().endsWith('.shp'));
    if (shpFiles.length === 0) {
      console.log(`No se encontraron archivos .shp en ${tempDir}`);
      return false;
    }
    
    // Convertir a GeoJSON
    const shpFile = path.join(tempDir, shpFiles[0]);
    const geojsonFile = path.join(tempDir, 'stops.geojson');
    
    try {
      console.log(`Convirtiendo shapefile a GeoJSON: ${shpFile} -> ${geojsonFile}`);
      execSync(`ogr2ogr -f GeoJSON "${geojsonFile}" "${shpFile}"`);
    } catch (error) {
      console.error(`Error al convertir shapefile a GeoJSON:`, error);
      return false;
    }
    
    // Leer y procesar GeoJSON
    if (!fs.existsSync(geojsonFile)) {
      console.log(`No se creó el archivo GeoJSON correctamente`);
      return false;
    }
    
    const geojsonContent = fs.readFileSync(geojsonFile, 'utf8');
    const geojson = JSON.parse(geojsonContent);
    
    if (!geojson.features || !Array.isArray(geojson.features)) {
      console.log(`El archivo GeoJSON no contiene features`);
      return false;
    }
    
    console.log(`Se encontraron ${geojson.features.length} paradas en el GeoJSON`);
    
    // Insertar paradas
    let insertedCount = 0;
    
    for (let i = 0; i < geojson.features.length; i++) {
      const feature = geojson.features[i];
      
      if (!feature.geometry || !feature.geometry.coordinates) {
        console.warn(`Parada sin coordenadas en el índice ${i}`);
        continue;
      }
      
      const coordinates = feature.geometry.coordinates;
      const name = `Parada ${routeId}-${i+1}`;
      const isTerminal = i === 0 || i === geojson.features.length - 1;
      const terminalType = i === 0 ? 'inicio' : (i === geojson.features.length - 1 ? 'fin' : '');
      
      try {
        await db.execute(sql`
          INSERT INTO bus_stops
          (route_id, name, latitude, longitude, is_terminal, terminal_type)
          VALUES (${routeId}, ${name}, ${coordinates[1].toString()}, ${coordinates[0].toString()}, ${isTerminal}, ${terminalType})
        `);
        
        insertedCount++;
        
        if (insertedCount % 10 === 0) {
          console.log(`Insertadas ${insertedCount} paradas...`);
        }
      } catch (error) {
        console.error(`Error al insertar parada ${name}:`, error);
      }
    }
    
    console.log(`Importación completada. Se importaron ${insertedCount} paradas de ${geojson.features.length}.`);
    
    // Limpiar archivos temporales
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Error al eliminar archivos temporales:`, error);
    }
    
    return insertedCount > 0;
  } catch (error) {
    console.error(`Error al procesar archivo ${file.path}:`, error);
    return false;
  }
}

async function main() {
  try {
    // Obtener mapeo de rutas y archivos de paradas
    const stopFiles = await findStopFiles();
    
    if (stopFiles.length === 0) {
      console.log("No se encontraron archivos de paradas para procesar");
      process.exit(1);
    }
    
    console.log(`Comenzando la importación de ${stopFiles.length} archivos de paradas...`);
    
    // Procesar cada archivo
    let processed = 0;
    let successful = 0;
    
    for (const file of stopFiles) {
      const success = await processStopFile(file);
      processed++;
      
      if (success) {
        successful++;
      }
      
      // Mostrar progreso
      console.log(`Progreso: ${processed}/${stopFiles.length} (${Math.round(processed/stopFiles.length*100)}%)`);
      
      // Pequeña pausa entre archivos
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\nProceso completado: Se procesaron ${successful}/${processed} archivos de paradas.`);
    process.exit(0);
  } catch (error) {
    console.error("Error en el programa principal:", error);
    process.exit(1);
  }
}

console.log("Iniciando script de importación de paradas...");
main();