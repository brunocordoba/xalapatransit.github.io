import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { pool } from '../server/db';
import { busStops, busRoutes } from '../shared/schema';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

const db = drizzle(pool);

async function findAllRoutes() {
  try {
    console.log("Obteniendo lista de rutas en la base de datos...");
    const allRoutes = await db.execute(sql`SELECT * FROM bus_routes ORDER BY id`);
    
    console.log(`Se encontraron ${allRoutes.rowCount} rutas en la base de datos`);
    return allRoutes.rows;
  } catch (error) {
    console.error("Error al obtener rutas:", error);
    return [];
  }
}

async function findStopFiles() {
  const baseDir = 'tmp/mapaton-extract';
  let result: { path: string; circuitoNum: number }[] = [];
  
  try {
    // Función recursiva para buscar archivos stops.zip
    function searchDir(dir: string) {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        
        if (fs.statSync(fullPath).isDirectory()) {
          searchDir(fullPath);
        } else if (item.toLowerCase() === 'stops.zip' || item.toLowerCase() === 'stop.zip') {
          // Extraer el número de circuito del path
          // Ej: tmp/mapaton-extract/shapefiles-mapton-ciudadano/10_circuito/stops.zip
          const parts = fullPath.split('/');
          let circuitoPart = '';
          
          for (const part of parts) {
            if (part.includes('_circuito') || part.includes('_ruta')) {
              circuitoPart = part;
              break;
            }
          }
          
          if (circuitoPart) {
            const match = circuitoPart.match(/^(\d+)_/);
            if (match) {
              const circuitoNum = parseInt(match[1], 10);
              result.push({ path: fullPath, circuitoNum });
            } else {
              console.log(`No se pudo extraer número de circuito de ${circuitoPart}`);
            }
          } else {
            console.log(`No se pudo identificar el circuito para ${fullPath}`);
          }
        }
      }
    }
    
    console.log(`Buscando archivos de paradas en ${baseDir}...`);
    searchDir(baseDir);
    console.log(`Se encontraron ${result.length} archivos de paradas`);
    
    return result;
  } catch (error) {
    console.error("Error al buscar archivos de paradas:", error);
    return [];
  }
}

async function processStopFile(file: { path: string; circuitoNum: number }, routes: any[]) {
  try {
    console.log(`\nProcesando archivo de paradas para circuito ${file.circuitoNum}: ${file.path}`);
    
    // Buscar la ruta correspondiente
    const matchingRoutes = routes.filter(route => {
      const nameMatch = route.name.includes(`Ruta ${file.circuitoNum}`);
      return nameMatch;
    });
    
    if (matchingRoutes.length === 0) {
      console.log(`No se encontró una ruta para el circuito ${file.circuitoNum} en la base de datos`);
      return false;
    }
    
    if (matchingRoutes.length > 1) {
      console.log(`Se encontraron ${matchingRoutes.length} rutas para el circuito ${file.circuitoNum}:`);
      matchingRoutes.forEach(r => console.log(`- ID: ${r.id}, Nombre: ${r.name}`));
    }
    
    // Trabajar con la primera ruta encontrada
    const route = matchingRoutes[0];
    console.log(`Usando ruta: ID ${route.id}, Nombre: ${route.name}`);
    
    // Verificar si la ruta ya tiene paradas
    const existingStopsResult = await db.execute(
      sql`SELECT COUNT(*) as count FROM bus_stops WHERE route_id = ${route.id}`
    );
    
    const existingStopsCount = parseInt(existingStopsResult.rows[0].count);
    if (existingStopsCount > 0) {
      console.log(`La ruta ${route.id} (${route.name}) ya tiene ${existingStopsCount} paradas, saltando...`);
      return true;
    }
    
    // Extraer el archivo stops.zip
    const zip = new AdmZip(file.path);
    
    // Crear un directorio temporal para extraer los archivos
    const tempDir = path.join('tmp', `stops_${route.id}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    zip.extractAllTo(tempDir, true);
    
    // Buscar el archivo .shp en el directorio temporal
    const shpFiles = fs.readdirSync(tempDir).filter(f => f.toLowerCase().endsWith('.shp'));
    if (shpFiles.length === 0) {
      console.log(`No se encontraron archivos .shp en ${file.path}`);
      return false;
    }
    
    const shpFile = path.join(tempDir, shpFiles[0]);
    const geojsonFile = path.join(tempDir, 'stops.geojson');
    
    // Convertir el shapefile a GeoJSON usando ogr2ogr
    console.log(`Convirtiendo shapefile a GeoJSON: ${shpFile} -> ${geojsonFile}`);
    await new Promise<void>((resolve, reject) => {
      const { spawn } = require('child_process');
      const process = spawn('ogr2ogr', ['-f', 'GeoJSON', geojsonFile, shpFile]);
      
      process.on('close', (code: number) => {
        if (code !== 0) {
          console.error(`ogr2ogr terminó con código ${code}`);
          reject(new Error(`Conversión falló con código ${code}`));
        } else {
          resolve();
        }
      });
    });
    
    // Leer el archivo GeoJSON
    if (!fs.existsSync(geojsonFile)) {
      console.log(`No se creó el archivo GeoJSON correctamente`);
      return false;
    }
    
    const geojsonContent = fs.readFileSync(geojsonFile, 'utf8');
    const geojson = JSON.parse(geojsonContent);
    
    if (!geojson.features || !Array.isArray(geojson.features)) {
      console.log(`El archivo GeoJSON no contiene features válidas`);
      return false;
    }
    
    // Insertar las paradas
    console.log(`Se encontraron ${geojson.features.length} paradas en el GeoJSON`);
    
    let stopsAdded = 0;
    for (let i = 0; i < geojson.features.length; i++) {
      const feature = geojson.features[i];
      if (!feature.geometry || !feature.geometry.coordinates) {
        console.log(`Característica sin coordenadas en el índice ${i}`);
        continue;
      }
      
      const coordinates = feature.geometry.coordinates;
      
      // Determinar el nombre de la parada
      let stopName = `Parada ${route.id}-${i+1}`;
      if (feature.properties) {
        const props = feature.properties;
        if (props.name) stopName = props.name;
        else if (props.NAME) stopName = props.NAME;
        else if (props.Name) stopName = props.Name;
      }
      
      // Determinar si es terminal
      const isTerminal = i === 0 || i === geojson.features.length - 1;
      const terminalType = i === 0 ? 'inicio' : (i === geojson.features.length - 1 ? 'fin' : '');
      
      try {
        // Insertar la parada en la base de datos
        await db.execute(sql`
          INSERT INTO bus_stops 
          (route_id, name, latitude, longitude, is_terminal, terminal_type)
          VALUES (${route.id}, ${stopName}, ${coordinates[1].toString()}, ${coordinates[0].toString()}, ${isTerminal}, ${terminalType})
        `);
        
        stopsAdded++;
      } catch (error) {
        console.error(`Error al insertar parada ${stopName}:`, error);
      }
    }
    
    console.log(`Se añadieron ${stopsAdded} paradas para la ruta ${route.id} (${route.name})`);
    
    // Limpiar directorio temporal
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.log(`No se pudo eliminar el directorio temporal: ${err}`);
    }
    
    return stopsAdded > 0;
  } catch (error) {
    console.error(`Error al procesar archivo ${file.path}:`, error);
    return false;
  }
}

async function main() {
  try {
    // Obtener todas las rutas
    const routes = await findAllRoutes();
    if (routes.length === 0) {
      console.error("No se encontraron rutas en la base de datos");
      process.exit(1);
    }
    
    // Encontrar archivos de paradas
    const stopFiles = await findStopFiles();
    if (stopFiles.length === 0) {
      console.error("No se encontraron archivos de paradas");
      process.exit(1);
    }
    
    // Procesar cada archivo de paradas
    let processed = 0;
    let successful = 0;
    
    for (const file of stopFiles) {
      const success = await processStopFile(file, routes);
      processed++;
      
      if (success) {
        successful++;
      }
      
      // Pequeña pausa entre operaciones
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`\nProceso completado. Se procesaron ${successful}/${processed} archivos con éxito.`);
    process.exit(0);
  } catch (error) {
    console.error("Error en el programa principal:", error);
    process.exit(1);
  }
}

// Ejecutar el programa
main();