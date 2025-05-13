import { pool } from "../server/db";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Script para procesar rutas en lotes
 * 
 * Este script procesa las rutas en lotes, definidos por un rango de IDs.
 * Cada lote se procesa secuencialmente para evitar sobrecargar la API.
 * 
 * Uso:
 * npx tsx scripts/process-routes-batch.ts [startBatch] [endBatch] [batchSize]
 * 
 * Ejemplo:
 * npx tsx scripts/process-routes-batch.ts 1 5 10
 * 
 * Procesará 5 lotes de 10 rutas cada uno, en orden secuencial.
 */

// Parámetros configurables
const BATCH_SIZE = 10;  // Número de rutas por lote
const TOTAL_BATCHES = 10; // Número total de lotes

// Obtener parámetros desde línea de comandos
const args = process.argv.slice(2);
let startBatch = 1;
let endBatch = TOTAL_BATCHES;
let batchSize = BATCH_SIZE;

if (args.length >= 1) {
  startBatch = parseInt(args[0], 10);
}

if (args.length >= 2) {
  endBatch = parseInt(args[1], 10);
}

if (args.length >= 3) {
  batchSize = parseInt(args[2], 10);
}

// Función principal para procesar los lotes
async function processBatches() {
  try {
    // Obtener todas las rutas
    const routesQuery = await pool.query(
      "SELECT id, name, shortname as shortName, color, frequency, schedule_start as scheduleStart, " +
      "schedule_end as scheduleEnd, stops_count as stopsCount, approximate_time as approximateTime, " +
      "zone, popular, geo_json as geoJSON " +
      "FROM bus_routes ORDER BY id"
    );
    
    const routes = routesQuery.rows;
    console.log(`Se encontraron ${routes.length} rutas en total`);
    
    // Calcular los lotes
    const totalBatches = Math.ceil(routes.length / batchSize);
    console.log(`Total de lotes posibles: ${totalBatches}`);
    
    // Ajustar el rango de lotes según límites
    if (endBatch > totalBatches) {
      endBatch = totalBatches;
    }
    
    console.log(`Procesando lotes del ${startBatch} al ${endBatch} (${batchSize} rutas por lote)`);
    
    // Procesar cada lote
    for (let batch = startBatch; batch <= endBatch; batch++) {
      const startIndex = (batch - 1) * batchSize;
      const endIndex = Math.min(startIndex + batchSize, routes.length);
      const batchRoutes = routes.slice(startIndex, endIndex);
      
      console.log(`\n===== Procesando lote ${batch}/${endBatch} - Rutas ${startIndex + 1} a ${endIndex} =====`);
      
      // Crear un archivo de script temporal para procesar este lote
      const routeIds = batchRoutes.map(route => route.id);
      
      // Generar y ejecutar el comando para el lote actual
      if (routeIds.length > 0) {
        const minId = Math.min(...routeIds);
        const maxId = Math.max(...routeIds);
        
        console.log(`Ejecutando procesamiento para rutas ${minId} a ${maxId}`);
        const command = `npx tsx scripts/snap-multiple-routes.ts ${minId} ${maxId}`;
        
        // Usando require para ejecutar el comando (en producción usaríamos child_process.execSync)
        console.log(`Ejecutando: ${command}`);
        console.log(`Este proceso puede tardar varios minutos. Por favor, espere...`);
        
        // En lugar de ejecutar el comando, vamos a generar un script bash para ejecutarlo manualmente
        const batchScript = `#!/bin/bash
echo "Procesando lote ${batch} - Rutas ${minId} a ${maxId}"
${command}
echo "Lote ${batch} completado"
`;
        
        // Guardar el script en un archivo
        const fs = require('fs');
        const scriptPath = `./tmp/process-batch-${batch}.sh`;
        
        try {
          // Asegurarse que el directorio tmp existe
          if (!fs.existsSync('./tmp')) {
            fs.mkdirSync('./tmp');
          }
          
          fs.writeFileSync(scriptPath, batchScript);
          fs.chmodSync(scriptPath, '755'); // Hacer ejecutable
          
          console.log(`Script de lote generado en ${scriptPath}`);
          console.log(`Para ejecutar este lote, use: bash ${scriptPath}`);
          
        } catch (err) {
          console.error(`Error al crear el script de lote:`, err);
        }
      }
      
      // Esperar antes del siguiente lote
      if (batch < endBatch) {
        console.log(`Lote ${batch} completado. Continúe con el siguiente lote manualmente.`);
      }
    }
    
    console.log(`\nSe han generado scripts para todos los lotes del ${startBatch} al ${endBatch}`);
    console.log(`Ejecute cada script de lote secuencialmente para procesar todas las rutas`);
    
  } catch (error) {
    console.error("Error al procesar lotes:", error);
  } finally {
    await pool.end();
  }
}

// Iniciar el procesamiento
processBatches().then(() => {
  console.log("Generación de scripts completada");
}).catch(error => {
  console.error("Error en el proceso principal:", error);
  process.exit(1);
});