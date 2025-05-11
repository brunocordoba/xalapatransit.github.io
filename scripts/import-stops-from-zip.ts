import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Buscar todos los archivos zip en una carpeta y sus subcarpetas
function findZipFiles(dir: string): string[] {
  let results: string[] = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const itemPath = path.join(dir, item);
    const stat = fs.statSync(itemPath);
    
    if (stat.isDirectory()) {
      // Si es un directorio, búsqueda recursiva
      results = results.concat(findZipFiles(itemPath));
    } else if (item.endsWith('.zip')) {
      // Si es un archivo ZIP, añadirlo a los resultados
      results.push(itemPath);
    }
  }
  
  return results;
}

// Extraer la información de la ruta a partir de la ruta del archivo
function extractRouteInfo(zipPath: string, manualRouteId?: number): { routeId: number; routeName: string; } | null {
  // Si se proporcionó un ID manual, usarlo
  if (manualRouteId !== undefined) {
    return {
      routeId: manualRouteId,
      routeName: path.basename(zipPath, '.zip')
    };
  }
  
  // Espera un formato como "ruta_123.zip" o "123_nombre_ruta.zip" o similar
  const fileName = path.basename(zipPath, '.zip');
  
  // Intentar extraer ID del nombre de varias formas
  
  // 1. Buscar números en el nombre del archivo
  const matches = fileName.match(/\d+/);
  if (matches && matches.length > 0) {
    const routeId = parseInt(matches[0]);
    if (!isNaN(routeId)) {
      return {
        routeId,
        routeName: fileName
      };
    }
  }
  
  // 2. Buscar patrones específicos como "ruta_X" o "route_X"
  const routeMatches = fileName.match(/ruta[_\s-]?(\d+)/i) || fileName.match(/route[_\s-]?(\d+)/i);
  if (routeMatches && routeMatches.length > 1) {
    const routeId = parseInt(routeMatches[1]);
    if (!isNaN(routeId)) {
      return {
        routeId,
        routeName: fileName
      };
    }
  }
  
  console.warn(`No se pudo extraer ID de ruta del archivo: ${zipPath}`);
  return null;
}

// Procesar todas las paradas dentro de un archivo ZIP
async function processStopsFromZip(zipPath: string, manualRouteId?: number): Promise<boolean> {
  try {
    // Extraer información de la ruta del nombre del archivo
    const routeInfo = extractRouteInfo(zipPath, manualRouteId);
    if (!routeInfo) {
      return false;
    }
    
    console.log(`Procesando paradas para la ruta ID: ${routeInfo.routeId} (${routeInfo.routeName})`);
    
    // Verificar si la ruta existe en la base de datos
    const [existingRoute] = await db.select().from(busRoutes).where(eq(busRoutes.id, routeInfo.routeId));
    
    if (!existingRoute) {
      console.warn(`La ruta con ID ${routeInfo.routeId} no existe en la base de datos. Omitiendo...`);
      return false;
    }
    
    // Abrir el archivo ZIP
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    
    // Buscar el archivo de paradas dentro del ZIP (normalmente termina con "_stops.json")
    const stopsEntry = zipEntries.find(entry => 
      entry.name.endsWith('_stops.json') || entry.name.includes('stops')
    );
    
    if (!stopsEntry) {
      console.warn(`No se encontró archivo de paradas en: ${zipPath}`);
      return false;
    }
    
    // Leer y parsear el contenido del archivo de paradas
    const stopsContent = stopsEntry.getData().toString('utf8');
    const stopsData = JSON.parse(stopsContent);
    
    // Verificar que el formato sea el esperado (GeoJSON)
    if (!stopsData.type || stopsData.type !== 'FeatureCollection' || !stopsData.features) {
      console.warn(`Formato de archivo de paradas no válido en: ${zipPath}`);
      return false;
    }
    
    // Eliminar paradas existentes para esta ruta (si hay)
    await db.delete(busStops).where(eq(busStops.routeId, routeInfo.routeId));
    
    console.log(`Encontradas ${stopsData.features.length} paradas para la ruta ${routeInfo.routeId}`);
    
    // Procesar cada parada y guardarla en la base de datos
    let stopsCount = 0;
    for (const feature of stopsData.features) {
      if (feature.type !== 'Feature' || !feature.geometry || feature.geometry.type !== 'Point') {
        console.warn(`Ignorando parada con formato incorrecto en ruta ${routeInfo.routeId}`);
        continue;
      }
      
      const coordinates = feature.geometry.coordinates;
      const properties = feature.properties || {};
      const isTerminal = stopsCount === 0 || stopsCount === stopsData.features.length - 1;
      const terminalType = isTerminal ? (stopsCount === 0 ? 'start' : 'end') : '';
      
      try {
        // Insertar la parada en la base de datos
        await db.insert(busStops).values({
          routeId: routeInfo.routeId,
          name: `Parada ${stopsCount + 1}${isTerminal ? ' (Terminal)' : ''}`,
          latitude: coordinates[1].toString(),
          longitude: coordinates[0].toString(),
          isTerminal: isTerminal,
          terminalType: terminalType
        });
        
        stopsCount++;
      } catch (err) {
        console.error(`Error al guardar parada para ruta ${routeInfo.routeId}:`, err);
      }
    }
    
    // Actualizar el contador de paradas en la ruta
    await db.update(busRoutes)
      .set({
        stopsCount: stopsCount
      })
      .where(eq(busRoutes.id, routeInfo.routeId));
    
    console.log(`Se guardaron ${stopsCount} paradas para la ruta ${routeInfo.routeId}`);
    return true;
  } catch (error) {
    console.error(`Error al procesar archivo de paradas ${zipPath}:`, error);
    return false;
  }
}

// Función principal para importar todas las paradas
async function importAllStopsFromZips(baseDir: string) {
  try {
    console.log(`Buscando archivos ZIP en: ${baseDir}`);
    const zipFiles = findZipFiles(baseDir);
    console.log(`Se encontraron ${zipFiles.length} archivos ZIP`);
    
    // Estadísticas
    let successCount = 0;
    let errorCount = 0;
    
    // Procesar cada archivo ZIP
    for (let i = 0; i < zipFiles.length; i++) {
      const zipPath = zipFiles[i];
      console.log(`[${i+1}/${zipFiles.length}] Procesando: ${zipPath}`);
      
      const success = await processStopsFromZip(zipPath);
      if (success) {
        successCount++;
      } else {
        errorCount++;
      }
      
      // Pequeña pausa para evitar sobrecargar la base de datos
      if (i < zipFiles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log('\n===== RESUMEN =====');
    console.log(`Total de archivos ZIP: ${zipFiles.length}`);
    console.log(`Procesados con éxito: ${successCount}`);
    console.log(`Errores: ${errorCount}`);
    
  } catch (error) {
    console.error('Error en el proceso de importación:', error);
  }
}

// Función para procesar un directorio o archivo ZIP específico
async function importStopsFromSpecific(pathToProcess: string) {
  try {
    const stats = fs.statSync(pathToProcess);
    
    if (stats.isDirectory()) {
      // Si es un directorio, importar todos los ZIP dentro
      await importAllStopsFromZips(pathToProcess);
    } else if (stats.isFile() && pathToProcess.endsWith('.zip')) {
      // Si es un archivo ZIP individual, procesarlo
      const success = await processStopsFromZip(pathToProcess);
      console.log(`Procesamiento ${success ? 'exitoso' : 'fallido'} para: ${pathToProcess}`);
    } else {
      console.error(`La ruta especificada no es un directorio o archivo ZIP válido: ${pathToProcess}`);
    }
  } catch (error) {
    console.error('Error al procesar la ruta especificada:', error);
  }
}

// Ejecutar la función principal
async function main() {
  try {
    // Obtener argumentos de línea de comandos
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      console.error('Debe especificar la ruta base como argumento. Ejemplo:');
      console.error('npx tsx import-stops-from-zip.ts ../data/mapaton');
      process.exit(1);
    }
    
    const pathToProcess = args[0];
    await importStopsFromSpecific(pathToProcess);
    
    console.log('Proceso completado con éxito');
    process.exit(0);
  } catch (error) {
    console.error('Error fatal:', error);
    process.exit(1);
  }
}

main();