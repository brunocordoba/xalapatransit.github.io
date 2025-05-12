import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { pool } from '../server/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

const db = drizzle(pool);

interface RouteMapping {
  circuitoId: number;
  routeIds: number[];
  routeNames: string[];
}

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

// Función para crear un mapeo entre el número de circuito (Ej: 10_circuito) y los IDs de rutas en la BD
async function createRouteMapping() {
  try {
    const routes = await getAllRoutes();
    const mappings: RouteMapping[] = [];
    
    // Extraer información de cada ruta
    for (const route of routes) {
      // Extraer el número de ruta del nombre (Ej: "13. Ruta 10 (Ida)" -> 10)
      const routeMatch = route.name.match(/Ruta\s+(\d+)(?:\s+\(|$)/i);
      if (routeMatch) {
        const routeNumber = parseInt(routeMatch[1], 10);
        
        // Buscar si ya existe un mapeo para este número de ruta
        let mapping = mappings.find(m => m.circuitoId === routeNumber);
        if (!mapping) {
          mapping = {
            circuitoId: routeNumber,
            routeIds: [],
            routeNames: []
          };
          mappings.push(mapping);
        }
        
        // Añadir el ID y nombre de esta ruta al mapeo
        mapping.routeIds.push(route.id);
        mapping.routeNames.push(route.name);
      }
    }
    
    console.log(`Se crearon ${mappings.length} mapeos de rutas.`);
    return mappings;
  } catch (error) {
    console.error("Error al crear mapeo de rutas:", error);
    return [];
  }
}

// Encuentra todos los archivos stops.zip en el directorio y sus subdirectorios
function findStopsZips(baseDir: string) {
  try {
    console.log(`Buscando archivos stops.zip en ${baseDir}...`);
    
    const results: { path: string; circuitoId: number }[] = [];
    
    // Función recursiva para buscar archivos
    function searchDir(dir: string) {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          searchDir(fullPath);
        } else if (item.toLowerCase() === 'stops.zip' || item.toLowerCase() === 'stop.zip') {
          // Extraer el número de circuito de la ruta
          const parts = fullPath.split('/');
          let circuitoPart = '';
          
          // Buscar la parte que contiene "_circuito" o "_ruta"
          for (const part of parts) {
            if (part.includes('_circuito') || part.includes('_ruta')) {
              circuitoPart = part;
              break;
            }
          }
          
          if (circuitoPart) {
            // Extraer el número de circuito (Ej: "10_circuito" -> 10)
            const circuitoMatch = circuitoPart.match(/^(\d+)_/);
            if (circuitoMatch) {
              const circuitoId = parseInt(circuitoMatch[1], 10);
              results.push({ path: fullPath, circuitoId });
            }
          }
        }
      }
    }
    
    searchDir(baseDir);
    console.log(`Se encontraron ${results.length} archivos stops.zip.`);
    return results;
  } catch (error) {
    console.error("Error al buscar archivos stops.zip:", error);
    return [];
  }
}

// Procesa un archivo stops.zip para extraer las paradas y guardarlas en la base de datos
async function processStopsZip(zipFile: { path: string; circuitoId: number }, routeMappings: RouteMapping[]) {
  try {
    console.log(`\nProcesando archivo: ${zipFile.path} (Circuito ${zipFile.circuitoId})`);
    
    // Buscar el mapeo de ruta correspondiente
    const mapping = routeMappings.find(m => m.circuitoId === zipFile.circuitoId);
    if (!mapping) {
      console.log(`No se encontró mapeo para el circuito ${zipFile.circuitoId}`);
      return false;
    }
    
    console.log(`Mapeo encontrado: Circuito ${mapping.circuitoId} -> Rutas: ${mapping.routeNames.join(', ')}`);
    
    // Usar el primer ID de ruta para las paradas
    const routeId = mapping.routeIds[0];
    console.log(`Usando ID de ruta: ${routeId} (${mapping.routeNames[0]})`);
    
    // Verificar si la ruta ya tiene paradas
    const existingStopsCount = await db.execute(
      sql`SELECT COUNT(*) as count FROM bus_stops WHERE route_id = ${routeId}`
    );
    
    if (parseInt(existingStopsCount.rows[0].count) > 0) {
      console.log(`La ruta ${routeId} ya tiene ${existingStopsCount.rows[0].count} paradas, saltando...`);
      return true;
    }
    
    // Crear un directorio temporal para extraer los archivos
    const tempDir = path.join('tmp', `stops_${routeId}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Extraer el archivo ZIP usando el comando unzip
    console.log(`Extrayendo ${zipFile.path} a ${tempDir}...`);
    try {
      execSync(`unzip -o "${zipFile.path}" -d "${tempDir}"`);
    } catch (error) {
      console.error(`Error al extraer archivo ZIP:`, error);
      return false;
    }
    
    // Buscar archivos .shp en el directorio temporal
    const shpFiles = fs.readdirSync(tempDir).filter(file => file.toLowerCase().endsWith('.shp'));
    if (shpFiles.length === 0) {
      console.log(`No se encontraron archivos .shp en ${tempDir}`);
      return false;
    }
    
    // Convertir el shapefile a GeoJSON
    const shpFile = path.join(tempDir, shpFiles[0]);
    const geojsonFile = path.join(tempDir, 'stops.geojson');
    
    console.log(`Convirtiendo shapefile a GeoJSON: ${shpFile} -> ${geojsonFile}`);
    try {
      execSync(`ogr2ogr -f GeoJSON "${geojsonFile}" "${shpFile}"`);
    } catch (error) {
      console.error(`Error al convertir shapefile a GeoJSON:`, error);
      return false;
    }
    
    // Verificar que se creó el archivo GeoJSON
    if (!fs.existsSync(geojsonFile)) {
      console.log(`No se creó el archivo GeoJSON correctamente`);
      return false;
    }
    
    // Leer y procesar el GeoJSON
    const geojsonContent = fs.readFileSync(geojsonFile, 'utf8');
    const geojson = JSON.parse(geojsonContent);
    
    if (!geojson.features || !Array.isArray(geojson.features)) {
      console.log(`El archivo GeoJSON no contiene features`);
      return false;
    }
    
    console.log(`Se encontraron ${geojson.features.length} paradas en el GeoJSON`);
    
    // Insertar las paradas en la base de datos
    let insertedCount = 0;
    
    for (let i = 0; i < geojson.features.length; i++) {
      const feature = geojson.features[i];
      
      if (!feature.geometry || !feature.geometry.coordinates) {
        console.warn(`Parada sin coordenadas en el índice ${i}`);
        continue;
      }
      
      // Extraer coordenadas
      const coordinates = feature.geometry.coordinates;
      
      // Generar nombre único para la parada
      const name = `Parada ${routeId}-${i+1}`;
      
      // Determinar si es terminal
      const isTerminal = i === 0 || i === geojson.features.length - 1;
      const terminalType = i === 0 ? 'inicio' : (i === geojson.features.length - 1 ? 'fin' : '');
      
      try {
        // Insertar parada
        await db.execute(sql`
          INSERT INTO bus_stops
          (route_id, name, latitude, longitude, is_terminal, terminal_type)
          VALUES (${routeId}, ${name}, ${coordinates[1].toString()}, ${coordinates[0].toString()}, ${isTerminal}, ${terminalType})
        `);
        
        insertedCount++;
      } catch (error) {
        console.error(`Error al insertar parada ${name}:`, error);
      }
    }
    
    console.log(`Se insertaron ${insertedCount} paradas para la ruta ${routeId}`);
    
    // Eliminar archivos temporales
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Error al eliminar archivos temporales:`, error);
    }
    
    return insertedCount > 0;
  } catch (error) {
    console.error(`Error al procesar archivo ${zipFile.path}:`, error);
    return false;
  }
}

async function main() {
  try {
    // Obtener el rango de circuitos a procesar (si se especifica)
    const args = process.argv.slice(2);
    let startCircuito = 1;
    let endCircuito = 99;
    
    if (args.length >= 2) {
      startCircuito = parseInt(args[0], 10);
      endCircuito = parseInt(args[1], 10);
      console.log(`Procesando circuitos en el rango ${startCircuito}-${endCircuito}`);
    }
    
    // Crear mapeo de rutas
    const routeMappings = await createRouteMapping();
    if (routeMappings.length === 0) {
      console.error("No se pudo crear el mapeo de rutas");
      process.exit(1);
    }
    
    // Encontrar archivos stops.zip
    const allStopsFiles = findStopsZips('tmp/mapaton-extract');
    if (allStopsFiles.length === 0) {
      console.error("No se encontraron archivos stops.zip");
      process.exit(1);
    }
    
    // Filtrar los archivos por el rango de circuitos
    const stopsFiles = allStopsFiles.filter(
      file => file.circuitoId >= startCircuito && file.circuitoId <= endCircuito
    );
    
    console.log(`Se procesarán ${stopsFiles.length} archivos stops.zip en el rango especificado`);
    
    // Procesar cada archivo stops.zip
    let processed = 0;
    let successful = 0;
    
    for (const stopsFile of stopsFiles) {
      const success = await processStopsZip(stopsFile, routeMappings);
      processed++;
      
      if (success) {
        successful++;
      }
      
      // Pequeña pausa entre archivos
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`\nProceso completado: Se procesaron ${successful}/${processed} archivos stops.zip`);
    process.exit(0);
  } catch (error) {
    console.error("Error en el programa principal:", error);
    process.exit(1);
  }
}

// Ejecutar el programa principal
main();