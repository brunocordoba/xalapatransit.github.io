import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { pool } from '../server/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

// Inicializar la base de datos
const db = drizzle(pool);

// Rutas con problemas específicos de importación (añadir más si se identifican)
const PROBLEMATIC_ROUTES = [
  { id: 388, name: '49. Ruta 31 (Ida)', circuitoNum: 31, hasIda: true, hasVuelta: false },
];

// Obtener detalles de la ruta
async function getRouteInfo(routeId: number) {
  try {
    const result = await db.execute(
      sql`SELECT id, name FROM bus_routes WHERE id = ${routeId}`
    );
    return result.rows[0];
  } catch (error) {
    console.error(`Error al obtener información de la ruta ${routeId}:`, error);
    return null;
  }
}

// Buscar archivo stops.zip correspondiente
function findStopsZip(circuitoNum: number, hasIda: boolean, hasVuelta: boolean) {
  const baseDir = 'tmp/mapaton-extract/shapefiles-mapton-ciudadano';
  
  // Construir la ruta basada en el número de circuito y dirección
  let targetDir = `${baseDir}/${circuitoNum}_`;
  
  // Buscar directorios que coincidan con el patrón
  const allDirs = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .filter(name => name.startsWith(`${circuitoNum}_`));
  
  if (allDirs.length === 0) {
    console.log(`No se encontraron directorios para el circuito ${circuitoNum}`);
    return null;
  }
  
  // Procesar cada directorio encontrado
  for (const dir of allDirs) {
    const fullDir = path.join(baseDir, dir);
    
    // Si es una ruta con ida/vuelta, buscar en el subdirectorio correspondiente
    if (hasIda) {
      const idaDir = path.join(fullDir, 'ida');
      if (fs.existsSync(idaDir) && fs.statSync(idaDir).isDirectory()) {
        const stopsFile = path.join(idaDir, 'stops.zip');
        if (fs.existsSync(stopsFile)) {
          return stopsFile;
        }
      }
    } else if (hasVuelta) {
      const vueltaDir = path.join(fullDir, 'vuelta');
      if (fs.existsSync(vueltaDir) && fs.statSync(vueltaDir).isDirectory()) {
        const stopsFile = path.join(vueltaDir, 'stops.zip');
        if (fs.existsSync(stopsFile)) {
          return stopsFile;
        }
      }
    } else {
      // Si es una ruta directa, buscar stops.zip en el directorio principal
      const stopsFile = path.join(fullDir, 'stops.zip');
      if (fs.existsSync(stopsFile)) {
        return stopsFile;
      }
    }
  }
  
  console.log(`No se encontró archivo stops.zip para el circuito ${circuitoNum}`);
  return null;
}

// Contar paradas existentes
async function getExistingStopsCount(routeId: number) {
  try {
    const result = await db.execute(
      sql`SELECT COUNT(*) as count FROM bus_stops WHERE route_id = ${routeId}`
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error(`Error al contar paradas existentes para la ruta ${routeId}:`, error);
    return 0;
  }
}

// Borrar paradas existentes
async function clearExistingStops(routeId: number) {
  try {
    const result = await db.execute(
      sql`DELETE FROM bus_stops WHERE route_id = ${routeId}`
    );
    console.log(`Se eliminaron ${result.rowCount} paradas existentes para la ruta ${routeId}`);
    return true;
  } catch (error) {
    console.error(`Error al borrar paradas para la ruta ${routeId}:`, error);
    return false;
  }
}

// Limpiar directorio temporal
function cleanTempDir(tempDir: string) {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// Procesar paradas desde GeoJSON sin validación estricta
async function processFeatures(routeId: number, features: any[]) {
  let insertedCount = 0;
  
  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    
    // Extraer coordenadas y asegurar que sean válidas
    let coordinates = feature.geometry?.coordinates;
    if (!coordinates) {
      console.warn(`Parada sin coordenadas en el índice ${i}, generando coordenadas aleatorias cercanas`);
      continue;
    }
    
    // Normalizar formato de coordenadas para asegurar compatibilidad
    if (typeof coordinates[0] === 'object' && coordinates[0].length === 2) {
      // Si es un array de arrays, tomar el primer elemento
      coordinates = coordinates[0];
    }
    
    const longitude = String(coordinates[0]);
    const latitude = String(coordinates[1]);
    const name = `Parada ${routeId}-${i+1}`;
    const isTerminal = i === 0 || i === features.length - 1;
    const terminalType = i === 0 ? 'inicio' : (i === features.length - 1 ? 'fin' : '');
    
    try {
      await db.execute(sql`
        INSERT INTO bus_stops
        (route_id, name, latitude, longitude, is_terminal, terminal_type)
        VALUES (${routeId}, ${name}, ${latitude}, ${longitude}, ${isTerminal}, ${terminalType})
      `);
      
      insertedCount++;
      
      if (insertedCount % 10 === 0) {
        console.log(`Insertadas ${insertedCount} paradas...`);
      }
    } catch (error) {
      console.error(`Error al insertar parada ${name}:`, error);
    }
  }
  
  return insertedCount;
}

// Procesar una ruta específica
async function processRoute(route: any) {
  console.log(`\nProcesando ruta problemática: ${route.name} (ID: ${route.id})`);
  
  // Paso 1: Encontrar el archivo stops.zip
  const stopsFile = findStopsZip(route.circuitoNum, route.hasIda, route.hasVuelta);
  if (!stopsFile) {
    console.log(`No se encontró archivo stops.zip para la ruta ${route.id}`);
    return false;
  }
  
  console.log(`Archivo encontrado: ${stopsFile}`);
  
  // Paso 2: Verificar paradas existentes
  const existingCount = await getExistingStopsCount(route.id);
  console.log(`La ruta tiene ${existingCount} paradas existentes`);
  
  // Paso 3: Borrar paradas existentes
  if (existingCount > 0) {
    const cleared = await clearExistingStops(route.id);
    if (!cleared) return false;
  }
  
  // Paso 4: Crear directorio temporal
  const tempDir = path.join('tmp', `fix_stops_${route.id}_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  
  try {
    // Paso 5: Extraer el archivo ZIP
    try {
      execSync(`unzip -o "${stopsFile}" -d "${tempDir}"`);
    } catch (error) {
      console.error(`Error al extraer ${stopsFile}:`, error);
      cleanTempDir(tempDir);
      return false;
    }
    
    // Paso 6: Buscar archivo .shp
    const shpFiles = fs.readdirSync(tempDir).filter(f => f.toLowerCase().endsWith('.shp'));
    
    if (shpFiles.length === 0) {
      console.log(`No se encontraron archivos .shp en ${tempDir}`);
      cleanTempDir(tempDir);
      return false;
    }
    
    // Paso 7: Convertir a GeoJSON
    const shpFile = path.join(tempDir, shpFiles[0]);
    const geojsonFile = path.join(tempDir, 'stops.geojson');
    
    try {
      execSync(`ogr2ogr -f GeoJSON "${geojsonFile}" "${shpFile}"`);
    } catch (error) {
      console.error(`Error al convertir a GeoJSON:`, error);
      cleanTempDir(tempDir);
      return false;
    }
    
    // Paso 8: Cargar y procesar el GeoJSON
    if (!fs.existsSync(geojsonFile)) {
      console.log(`No se generó el archivo GeoJSON correctamente`);
      cleanTempDir(tempDir);
      return false;
    }
    
    const geojsonContent = fs.readFileSync(geojsonFile, 'utf8');
    const geojson = JSON.parse(geojsonContent);
    
    if (!geojson.features || !Array.isArray(geojson.features)) {
      console.log(`El archivo GeoJSON no contiene features válidas`);
      cleanTempDir(tempDir);
      return false;
    }
    
    console.log(`Se encontraron ${geojson.features.length} paradas en el GeoJSON`);
    
    // Paso 9: Procesar e insertar las paradas con validación menos estricta
    const insertedCount = await processFeatures(route.id, geojson.features);
    
    console.log(`Se insertaron ${insertedCount} paradas para la ruta ${route.id} (${route.name})`);
    
    cleanTempDir(tempDir);
    return insertedCount > 0;
  } catch (error) {
    console.error(`Error general al procesar la ruta ${route.id}:`, error);
    cleanTempDir(tempDir);
    return false;
  }
}

// Función principal
async function fixMissingStops() {
  console.log("Iniciando corrección de paradas faltantes...");
  
  // Para cada ruta en la lista de problemáticas
  for (const routeInfo of PROBLEMATIC_ROUTES) {
    const route = await getRouteInfo(routeInfo.id);
    if (!route) {
      console.log(`No se encontró la ruta con ID ${routeInfo.id}`);
      continue;
    }
    
    // Combinar información
    const combinedRoute = { ...route, ...routeInfo };
    
    // Procesar la ruta
    const success = await processRoute(combinedRoute);
    if (success) {
      console.log(`✅ Ruta ${combinedRoute.id} procesada con éxito`);
    } else {
      console.log(`❌ Error al procesar la ruta ${combinedRoute.id}`);
    }
  }
  
  console.log("\nProceso de corrección finalizado.");
}

// Ejecución principal
fixMissingStops()
  .then(() => {
    console.log("Corrección de paradas finalizada.");
    process.exit(0);
  })
  .catch(error => {
    console.error("Error en el proceso principal:", error);
    process.exit(1);
  });