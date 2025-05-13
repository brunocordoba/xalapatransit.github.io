import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Importar las funciones y la conexión a la base de datos
import { snapRouteToRoad, pool, db } from './snap-single-route';
import { busRoutes } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Configuración
const BATCH_SIZE = 3; // Número de rutas a procesar por lote
const DELAY_BETWEEN_ROUTES = 2000; // 2 segundos entre rutas
const DELAY_BETWEEN_BATCHES = 10000; // 10 segundos entre lotes

// Función para procesar un rango de rutas
async function processRoutes(startId = 700, endId = 710) {
  try {
    console.log(`Iniciando procesamiento de rutas ${startId} a ${endId}...`);
    
    // Buscar todas las rutas (no podemos usar la condición WHERE con operadores de comparación directamente)
    const routes = await db.select().from(busRoutes);
    
    // Filtrar manualmente para asegurarnos de obtener solo las rutas en el rango
    const filteredRoutes = routes.filter(route => 
      route.id >= startId && route.id <= endId
    );
    
    console.log(`Se encontraron ${filteredRoutes.length} rutas en el rango especificado.`);
    
    if (filteredRoutes.length === 0) {
      console.log('No hay rutas para procesar en este rango.');
      return;
    }
    
    // Crear directorio de backup
    const backupDir = path.join(__dirname, '../data/backup');
    await fs.mkdir(backupDir, { recursive: true });
    
    // Guardar una copia de las rutas antes de comenzar
    await fs.writeFile(
      path.join(backupDir, `routes_${startId}_${endId}_backup_${new Date().toISOString().replace(/:/g, '-')}.json`),
      JSON.stringify(filteredRoutes, null, 2)
    );
    
    // Dividir en lotes
    const batches = [];
    for (let i = 0; i < filteredRoutes.length; i += BATCH_SIZE) {
      batches.push(filteredRoutes.slice(i, i + BATCH_SIZE));
    }
    console.log(`Dividido en ${batches.length} lotes de máximo ${BATCH_SIZE} rutas cada uno`);
    
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
    
    console.log(`\n✅ Proceso completado. Total: ${filteredRoutes.length} rutas | Éxitos: ${successCount} | Errores: ${errorCount}`);
  } catch (error) {
    console.error('Error general al procesar las rutas:', error);
  }
}

// Ejecución principal
async function main() {
  const args = process.argv.slice(2);
  
  try {
    let startId = 700;
    let endId = 710;
    
    // Procesar argumentos
    if (args.length >= 2) {
      startId = parseInt(args[0], 10);
      endId = parseInt(args[1], 10);
      
      if (isNaN(startId) || isNaN(endId) || startId < 0 || endId < startId) {
        console.error('Rango inválido. Uso: tsx scripts/process-routes-batch.ts <id_inicio> <id_fin>');
        process.exit(1);
      }
    }
    
    console.log(`Iniciando proceso de ajuste de rutas a carreteras...`);
    console.log(`Procesando rutas del ID ${startId} al ${endId}`);
    
    await processRoutes(startId, endId);
  } catch (error) {
    console.error('Error en el script principal:', error);
  }
}

main();