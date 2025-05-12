import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { pool } from '../server/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

// Inicializar la base de datos
const db = drizzle(pool);

// Obtener todas las rutas de la base de datos
async function getAllRoutes() {
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

// Procesar todas las paradas para todas las rutas
async function processAllRouteStops() {
  // Paso 1: Obtener todas las rutas
  const routes = await getAllRoutes();
  
  // Paso 2: Crear un mapa de números de circuito a IDs de ruta
  const routeMap = new Map();
  for (const route of routes) {
    const routeName = String(route.name);
    const routeMatch = routeName.match(/Ruta\s+(\d+)(?:\s+\(|$)/i);
    
    if (routeMatch) {
      const circuitoNum = parseInt(routeMatch[1], 10);
      if (!routeMap.has(circuitoNum)) {
        routeMap.set(circuitoNum, []);
      }
      
      routeMap.get(circuitoNum).push({
        id: parseInt(route.id),
        name: routeName,
        // Verificar si es una ruta de ida o vuelta
        isIda: routeName.includes('(Ida)'),
        isVuelta: routeName.includes('(Vuelta)')
      });
    }
  }
  
  console.log(`Se crearon mapeos para ${routeMap.size} circuitos.`);
  
  // Paso 3: Encontrar todos los archivos stops.zip
  const baseDir = 'tmp/mapaton-extract';
  const stopsFiles = [];
  
  function findStopsZips(dir: string) {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        findStopsZips(fullPath);
      } else if (item.toLowerCase() === 'stops.zip') {
        // Extraer el número de circuito de la ruta
        const parts = fullPath.split('/');
        let circuitoNum = -1;
        let circuitoPath = '';
        let hasIda = fullPath.includes('/ida/');
        let hasVuelta = fullPath.includes('/vuelta/');
        
        for (const part of parts) {
          const match = part.match(/^(\d+)_/);
          if (match) {
            circuitoNum = parseInt(match[1], 10);
            circuitoPath = part;
            break;
          }
        }
        
        if (circuitoNum > 0) {
          stopsFiles.push({
            path: fullPath,
            circuitoNum,
            circuitoPath,
            hasIda,
            hasVuelta
          });
        }
      }
    }
  }
  
  findStopsZips(baseDir);
  console.log(`Se encontraron ${stopsFiles.length} archivos stops.zip.`);
  
  // Paso 4: Procesar cada archivo de paradas
  let processedCount = 0;
  let successCount = 0;
  
  // Ordenar los archivos por número de circuito para procesarlos en orden
  stopsFiles.sort((a, b) => a.circuitoNum - b.circuitoNum);
  
  for (const stopsFile of stopsFiles) {
    try {
      console.log(`\nProcesando ${stopsFile.path} (Circuito ${stopsFile.circuitoNum})`);
      
      // Buscar las rutas correspondientes a este circuito
      const matchingRoutes = routeMap.get(stopsFile.circuitoNum) || [];
      
      if (matchingRoutes.length === 0) {
        console.log(`No se encontraron rutas para el circuito ${stopsFile.circuitoNum}`);
        processedCount++;
        continue;
      }
      
      // Seleccionar la ruta apropiada según si es ida/vuelta
      let selectedRoute = matchingRoutes[0];
      
      if (stopsFile.hasIda && matchingRoutes.some(r => r.isIda)) {
        selectedRoute = matchingRoutes.find(r => r.isIda) || selectedRoute;
      } else if (stopsFile.hasVuelta && matchingRoutes.some(r => r.isVuelta)) {
        selectedRoute = matchingRoutes.find(r => r.isVuelta) || selectedRoute;
      }
      
      const routeId = selectedRoute.id;
      const routeName = selectedRoute.name;
      
      console.log(`Usando ruta: ${routeName} (ID: ${routeId})`);
      
      // Verificar si la ruta ya tiene paradas
      const existingStopsResult = await db.execute(
        sql`SELECT COUNT(*) as count FROM bus_stops WHERE route_id = ${routeId}`
      );
      
      const existingStopsCount = parseInt(existingStopsResult.rows[0].count);
      if (existingStopsCount > 0) {
        console.log(`La ruta ${routeId} ya tiene ${existingStopsCount} paradas, saltando...`);
        processedCount++;
        successCount++;
        continue;
      }
      
      // Crear un directorio temporal
      const tempDir = path.join('tmp', `stops_${routeId}_${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      
      // Extraer el archivo ZIP
      try {
        execSync(`unzip -o "${stopsFile.path}" -d "${tempDir}"`);
      } catch (error) {
        console.error(`Error al extraer ${stopsFile.path}:`, error);
        processedCount++;
        continue;
      }
      
      // Buscar archivo .shp
      const shpFiles = fs.readdirSync(tempDir).filter(f => f.toLowerCase().endsWith('.shp'));
      
      if (shpFiles.length === 0) {
        console.log(`No se encontraron archivos .shp en ${tempDir}`);
        fs.rmSync(tempDir, { recursive: true, force: true });
        processedCount++;
        continue;
      }
      
      // Convertir a GeoJSON
      const shpFile = path.join(tempDir, shpFiles[0]);
      const geojsonFile = path.join(tempDir, 'stops.geojson');
      
      try {
        execSync(`ogr2ogr -f GeoJSON "${geojsonFile}" "${shpFile}"`);
      } catch (error) {
        console.error(`Error al convertir a GeoJSON:`, error);
        fs.rmSync(tempDir, { recursive: true, force: true });
        processedCount++;
        continue;
      }
      
      // Procesar el GeoJSON
      if (!fs.existsSync(geojsonFile)) {
        console.log(`No se generó el archivo GeoJSON correctamente`);
        fs.rmSync(tempDir, { recursive: true, force: true });
        processedCount++;
        continue;
      }
      
      const geojsonContent = fs.readFileSync(geojsonFile, 'utf8');
      const geojson = JSON.parse(geojsonContent);
      
      if (!geojson.features || !Array.isArray(geojson.features) || geojson.features.length === 0) {
        console.log(`El archivo GeoJSON no contiene paradas válidas`);
        fs.rmSync(tempDir, { recursive: true, force: true });
        processedCount++;
        continue;
      }
      
      console.log(`Se encontraron ${geojson.features.length} paradas en el GeoJSON`);
      
      // Insertar las paradas
      let insertedCount = 0;
      
      for (let i = 0; i < geojson.features.length; i++) {
        const feature = geojson.features[i];
        
        if (!feature.geometry || !feature.geometry.coordinates || !Array.isArray(feature.geometry.coordinates)) {
          console.warn(`Parada sin coordenadas válidas en el índice ${i}`);
          continue;
        }
        
        // Validar las coordenadas
        const coordinates = feature.geometry.coordinates;
        if (coordinates.length !== 2 || typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number') {
          console.warn(`Coordenadas inválidas para la parada ${i}:`, coordinates);
          continue;
        }
        
        const longitude = coordinates[0].toString();
        const latitude = coordinates[1].toString();
        const name = `Parada ${routeId}-${i+1}`;
        const isTerminal = i === 0 || i === geojson.features.length - 1;
        const terminalType = i === 0 ? 'inicio' : (i === geojson.features.length - 1 ? 'fin' : '');
        
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
      
      console.log(`Se insertaron ${insertedCount} paradas para la ruta ${routeId} (${routeName})`);
      
      // Limpiar directorio temporal
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      // Actualizar contadores
      processedCount++;
      if (insertedCount > 0) {
        successCount++;
      }
      
      console.log(`Progreso: ${processedCount}/${stopsFiles.length} (${Math.round(processedCount/stopsFiles.length*100)}%)`);
      
      // Pequeña pausa para no saturar la BD
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error al procesar ${stopsFile.path}:`, error);
      processedCount++;
    }
  }
  
  console.log(`\nProceso completo: ${successCount}/${processedCount} archivos de paradas procesados con éxito.`);
}

// Ejecución principal
console.log("Iniciando importación de todas las paradas...");
processAllRouteStops()
  .then(() => {
    console.log("Proceso de importación finalizado.");
    process.exit(0);
  })
  .catch(error => {
    console.error("Error en el proceso principal:", error);
    process.exit(1);
  });