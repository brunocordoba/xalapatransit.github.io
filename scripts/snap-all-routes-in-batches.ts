import { drizzle } from 'drizzle-orm/neon-serverless';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Importar schema
import { busRoutes } from '../shared/schema';

// Importar las funciones y la conexión a la base de datos del otro script
import { snapRouteToRoad, pool, db } from './snap-single-route';

// Importar tipo BusRoute para TypeScript
import { BusRoute } from '../shared/schema';

// Configuración
const BATCH_SIZE = 3; // Número de rutas a procesar por lote
const DELAY_BETWEEN_ROUTES = 2000; // 2 segundos entre rutas
const DELAY_BETWEEN_BATCHES = 10000; // 10 segundos entre lotes

// Función para procesar todas las rutas en lotes
async function processAllRoutes(startRoute = 0, endRoute?: number) {
  try {
    // Obtener todas las rutas
    const routes = await db.select().from(busRoutes);
    console.log(`Se encontraron ${routes.length} rutas en total.`);
    
    // Crear directorio de backup
    const backupDir = path.join(__dirname, '../data/backup');
    await fs.mkdir(backupDir, { recursive: true });
    
    // Guardar una copia de todas las rutas antes de comenzar
    await fs.writeFile(
      path.join(backupDir, `all_routes_backup_${new Date().toISOString().replace(/:/g, '-')}.json`),
      JSON.stringify(routes, null, 2)
    );
    
    // Limitar el rango si se especifica
    const routesToProcess = endIndex
      ? routes.slice(startIndex, endIndex)
      : routes.slice(startIndex);
    
    console.log(`Procesando ${routesToProcess.length} rutas (${startIndex} -> ${startIndex + routesToProcess.length - 1})`);
    
    // Dividir en lotes
    const batches = [];
    for (let i = 0; i < routesToProcess.length; i += BATCH_SIZE) {
      batches.push(routesToProcess.slice(i, i + BATCH_SIZE));
    }
    console.log(`Dividido en ${batches.length} lotes de ${BATCH_SIZE} rutas`);
    
    // Procesar cada lote
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`\nProcesando lote ${i + 1}/${batches.length} (${batch.length} rutas):`);
      
      // Procesar cada ruta en el lote secuencialmente
      for (const route of batch) {
        console.log(`\n- Ruta ${route.id}: ${route.name} (${route.shortName})`);
        
        try {
          const success = await snapRouteToRoad(route.id);
          if (success) {
            successCount++;
            console.log(`  ✅ Éxito - Ruta ${route.id} ajustada correctamente`);
          } else {
            errorCount++;
            console.log(`  ❌ Error - No se pudo ajustar la ruta ${route.id}`);
          }
        } catch (error) {
          errorCount++;
          console.error(`  ❌ Error procesando ruta ${route.id}:`, error);
        }
        
        // Esperar un tiempo entre rutas dentro del mismo lote
        if (batch.indexOf(route) < batch.length - 1) {
          console.log(`  ⏳ Esperando ${DELAY_BETWEEN_ROUTES/1000} segundos...`);
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ROUTES));
        }
      }
      
      // Esperar entre lotes
      if (i < batches.length - 1) {
        console.log(`\n⏳ Lote ${i + 1} completado. Esperando ${DELAY_BETWEEN_BATCHES/1000} segundos antes del siguiente lote...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }
    
    console.log(`\n✅ Proceso completado. Total: ${routesToProcess.length} rutas | Éxitos: ${successCount} | Errores: ${errorCount}`);
  } catch (error) {
    console.error('Error general al procesar todas las rutas:', error);
  }
}

// Ejecución principal
async function main() {
  const args = process.argv.slice(2);
  
  try {
    let startIndex = 0;
    let endIndex: number | undefined = undefined;
    
    // Procesar argumentos
    if (args.length > 0) {
      // --range start end
      if (args[0] === '--range' && args.length >= 3) {
        startIndex = parseInt(args[1], 10);
        endIndex = parseInt(args[2], 10);
        
        if (isNaN(startIndex) || isNaN(endIndex) || startIndex < 0 || endIndex < startIndex) {
          console.error('Rango inválido. Uso: --range <inicio> <fin>');
          process.exit(1);
        }
      }
      // --start index
      else if (args[0] === '--start' && args.length >= 2) {
        startIndex = parseInt(args[1], 10);
        
        if (isNaN(startIndex) || startIndex < 0) {
          console.error('Índice de inicio inválido. Uso: --start <indice>');
          process.exit(1);
        }
      }
    }
    
    console.log(`Iniciando proceso de ajuste de rutas a carreteras...`);
    if (endIndex !== undefined) {
      console.log(`Procesando rutas del índice ${startIndex} al ${endIndex}`);
    } else if (startIndex > 0) {
      console.log(`Procesando rutas a partir del índice ${startIndex}`);
    } else {
      console.log(`Procesando todas las rutas`);
    }
    
    await processAllRoutes(startIndex, endIndex);
  } catch (error) {
    console.error('Error en el script principal:', error);
  } finally {
    await pool.end();
    console.log('Conexión a la base de datos cerrada.');
  }
}

main();