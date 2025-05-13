import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Importar las funciones y la conexión a la base de datos
import { enhancedSnapRouteToRoad, pool, db } from './enhanced-snap-to-road';
import { busRoutes } from '../shared/schema';

// Configuración
const BATCH_SIZE = 2; // Número de rutas a procesar por lote (reducido para mayor estabilidad)
const DELAY_BETWEEN_ROUTES = 3000; // 3 segundos entre rutas
const DELAY_BETWEEN_BATCHES = 15000; // 15 segundos entre lotes (más tiempo para evitar límites de API)

// Función para procesar un rango de rutas
async function processRoutesEnhanced(startId = 700, endId = 710, specificIds?: number[]) {
  try {
    console.log(`Iniciando procesamiento mejorado de rutas...`);
    
    // Buscar todas las rutas
    const routes = await db.select().from(busRoutes);
    let filteredRoutes;
    
    if (specificIds && specificIds.length > 0) {
      // Si hay IDs específicos, filtrar por ellos
      filteredRoutes = routes.filter(route => specificIds.includes(route.id));
      console.log(`Procesando ${filteredRoutes.length} rutas específicas: ${specificIds.join(', ')}`);
    } else {
      // Sino, filtrar por rango
      filteredRoutes = routes.filter(route => 
        route.id >= startId && route.id <= endId
      );
      console.log(`Procesando rutas en el rango ${startId}-${endId}. Se encontraron ${filteredRoutes.length} rutas.`);
    }
    
    if (filteredRoutes.length === 0) {
      console.log('No hay rutas para procesar según los criterios especificados.');
      return;
    }
    
    // Crear directorio de backup
    const backupDir = path.join(__dirname, '../data/backup');
    await fs.mkdir(backupDir, { recursive: true });
    
    // Guardar una copia de las rutas antes de comenzar
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    await fs.writeFile(
      path.join(backupDir, `routes_enhanced_backup_${timestamp}.json`),
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
          const success = await enhancedSnapRouteToRoad(route.id);
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
    
    console.log(`\n✅ Proceso mejorado completado. Total: ${filteredRoutes.length} rutas | Éxitos: ${successCount} | Errores: ${errorCount}`);
  } catch (error) {
    console.error('Error general al procesar las rutas:', error);
  }
}

// Ejecución principal
async function main() {
  const args = process.argv.slice(2);
  
  try {
    if (args.length > 0 && args[0] === '--specific') {
      // Modo de IDs específicos
      const specificIds = args.slice(1).map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      
      if (specificIds.length === 0) {
        console.error('No se proporcionaron IDs válidos. Uso: tsx scripts/process-routes-enhanced.ts --specific 702 705 710');
        process.exit(1);
      }
      
      await processRoutesEnhanced(0, 0, specificIds);
    } else {
      // Modo de rango
      let startId = 700;
      let endId = 710;
      
      if (args.length >= 2) {
        startId = parseInt(args[0], 10);
        endId = parseInt(args[1], 10);
        
        if (isNaN(startId) || isNaN(endId) || startId < 0 || endId < startId) {
          console.error('Rango inválido. Uso: tsx scripts/process-routes-enhanced.ts <id_inicio> <id_fin>');
          process.exit(1);
        }
      }
      
      console.log(`Iniciando proceso mejorado de ajuste de rutas a carreteras...`);
      console.log(`Procesando rutas del ID ${startId} al ${endId}`);
      
      await processRoutesEnhanced(startId, endId);
    }
  } catch (error) {
    console.error('Error en el script principal:', error);
  } finally {
    await pool.end();
  }
}

main();