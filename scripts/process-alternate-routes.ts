/**
 * Script para importar las rutas alternativas (34-44) que tienen una estructura especial con subcarpetas ruta_1 y ruta_2
 */

import * as fs from 'fs';
import * as path from 'path';
import { db } from '../server/db';
import { busRoutes } from '../shared/schema';
import { storage } from '../server/storage';
import * as util from 'util';
import { exec } from 'child_process';

// Promisificar exec para usar con async/await
const execAsync = util.promisify(exec);

// Constantes para directorios y archivos
const PROCESSED_DIR = './tmp/processed';
const MAPATON_DIR = './tmp/mapaton-extract/shapefiles-mapton-ciudadano';

// Crear directorios de procesamiento si no existen
if (!fs.existsSync(PROCESSED_DIR)) {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
}

// Colores para zonas
const zoneColors: Record<string, string> = {
  'norte': '#EF4444', // red-500
  'sur': '#3B82F6',   // blue-500
  'este': '#22C55E',  // green-500
  'oeste': '#A855F7', // purple-500
  'centro': '#F97316' // orange-500
};

/**
 * Determina la zona de una ruta según su ID
 */
function determineZone(routeId: number): string {
  let zone = 'centro';
  if (routeId >= 1 && routeId <= 30) zone = 'norte';
  if (routeId >= 31 && routeId <= 60) zone = 'sur';
  if (routeId >= 61 && routeId <= 90) zone = 'este';
  if (routeId >= 91 && routeId <= 120) zone = 'oeste';
  return zone;
}

/**
 * Procesa una ruta alternativa (con estructura ruta_1 o ruta_2)
 */
async function processAlternateRoute(routeId: number, alternateNum: number) {
  try {
    const routeDir = path.join(MAPATON_DIR, `${routeId}_circuito`);
    const routeSubDir = path.join(routeDir, `ruta_${alternateNum}`);
    
    console.log(`Procesando ruta ${routeId} (Alternativa ${alternateNum})...`);
    
    // Verificar si existe el directorio
    if (!fs.existsSync(routeDir)) {
      console.log(`⚠️ No existe el directorio para la ruta ${routeId}`);
      return { success: false, message: 'Directorio no encontrado' };
    }
    
    if (!fs.existsSync(routeSubDir)) {
      console.log(`⚠️ No existe el subdirectorio ruta_${alternateNum} para la ruta ${routeId}`);
      return { success: false, message: 'Subdirectorio no encontrado' };
    }
    
    // Verificar si existe el archivo de ruta
    const routeZipPath = path.join(routeSubDir, 'route.zip');
    if (!fs.existsSync(routeZipPath)) {
      console.log(`⚠️ No existe el archivo route.zip para la ruta ${routeId} (alternativa ${alternateNum})`);
      return { success: false, message: 'Archivo route.zip no encontrado' };
    }
    
    // Crear directorios temporales
    const tmpDir = path.join(PROCESSED_DIR, `route_${routeId}_alt${alternateNum}`);
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    
    const routeShpDir = path.join(tmpDir, 'route');
    if (!fs.existsSync(routeShpDir)) {
      fs.mkdirSync(routeShpDir, { recursive: true });
    }
    
    try {
      // Extraer archivo de ruta
      await execAsync(`unzip -o ${routeZipPath} -d ${routeShpDir}`);
      
      // Buscar archivo .shp para la ruta
      const routeShpFiles = fs.readdirSync(routeShpDir)
        .filter(file => file.endsWith('.shp'))
        .map(file => path.join(routeShpDir, file));
        
      if (routeShpFiles.length === 0) {
        console.log(`⚠️ No se encontraron archivos .shp en ${routeShpDir}`);
        return { success: false, message: 'No hay archivos .shp' };
      }
      
      // Convertir shapefile de ruta a GeoJSON
      const routeShpFile = routeShpFiles[0];
      const routeGeoJsonFile = path.join(tmpDir, 'route.geojson');
      
      await execAsync(`ogr2ogr -f GeoJSON ${routeGeoJsonFile} ${routeShpFile}`);
      
      if (!fs.existsSync(routeGeoJsonFile)) {
        console.log(`⚠️ Error al convertir shapefile a GeoJSON: ${routeShpFile}`);
        return { success: false, message: 'Error al convertir a GeoJSON' };
      }
      
      // Leer archivo GeoJSON y extraer datos
      const routeGeoJson = JSON.parse(fs.readFileSync(routeGeoJsonFile, 'utf8'));
      
      if (!routeGeoJson || !routeGeoJson.features || routeGeoJson.features.length === 0) {
        console.log(`⚠️ No se encontraron características en el GeoJSON de la ruta ${routeId}`);
        return { success: false, message: 'GeoJSON sin características' };
      }
      
      // Usar primera característica como ruta
      const routeFeature = routeGeoJson.features[0];
      const routeCoordinates = routeFeature.geometry?.coordinates || [];
      
      if (!routeCoordinates || routeCoordinates.length === 0) {
        console.log(`⚠️ No se encontraron coordenadas en la ruta ${routeId}`);
        return { success: false, message: 'No hay coordenadas' };
      }
      
      // Determinar zona
      const zone = determineZone(routeId);
      const color = zoneColors[zone];
      
      // Generar nombres
      const routeIdWithOffset = alternateNum === 1 ? routeId : routeId + 100;
      const routeName = `Ruta ${routeId} (Alternativa ${alternateNum})`;
      const shortName = `R${routeId}A${alternateNum}`;
      
      // Verificar si ya existe
      const existingRoutes = await db.query.busRoutes.findMany({
        where: (busRoutes, { eq }) => eq(busRoutes.name, routeName)
      });
      
      if (existingRoutes.length > 0) {
        console.log(`La ruta ${routeName} ya existe en la base de datos, omitiendo...`);
        return { success: true, message: 'La ruta ya existe' };
      }
      
      // Crear objeto GeoJSON para la ruta
      const finalRouteGeoJSON = {
        type: 'Feature',
        properties: {
          id: routeIdWithOffset,
          name: routeName,
          shortName: shortName,
          color: color
        },
        geometry: {
          type: 'LineString',
          coordinates: routeCoordinates
        }
      };
      
      // Generar datos complementarios
      const approximateTime = routeCoordinates.length < 50 ? '15-20 min' :
                             routeCoordinates.length < 100 ? '20-30 min' :
                             routeCoordinates.length < 200 ? '30-45 min' :
                             routeCoordinates.length < 300 ? '45-60 min' : '60+ min';
                             
      const frequencies = ['10-15 min', '15-20 min', '20-30 min', '30-40 min', '15-25 min', '20-25 min'];
      const frequency = frequencies[Math.floor(Math.random() * frequencies.length)];
      
      // Crear ruta en la base de datos
      const route = await storage.createRoute({
        name: routeName,
        shortName: shortName,
        color: color,
        frequency: frequency,
        scheduleStart: '05:30 AM',
        scheduleEnd: '22:30 PM',
        stopsCount: 0, // Se actualizará después
        approximateTime: approximateTime,
        zone: zone,
        popular: true,
        geoJSON: finalRouteGeoJSON
      });
      
      console.log(`✅ Ruta creada: ${routeName} (ID: ${route.id}) con ${routeCoordinates.length} puntos`);
      
      // Generar paradas automáticamente
      console.log(`Generando paradas automáticas para la ruta ${routeId}...`);
      
      // Determinar número óptimo de paradas según longitud de la ruta
      const totalStops = Math.min(
        Math.max(10, Math.floor(routeCoordinates.length / 50)),
        40 // máximo 40 paradas para evitar demasiada densidad
      );
      
      let stopsCount = 0;
      
      // Terminal origen
      const firstCoord = routeCoordinates[0];
      await storage.createStop({
        routeId: route.id,
        name: `Terminal Origen (R${routeId})`,
        latitude: firstCoord[1].toString(),
        longitude: firstCoord[0].toString(),
        isTerminal: true,
        terminalType: 'first'
      });
      stopsCount++;
      
      // Paradas intermedias
      const step = Math.floor(routeCoordinates.length / (totalStops - 1));
      for (let i = 1; i < totalStops - 1; i++) {
        const index = i * step;
        if (index < routeCoordinates.length) {
          const coord = routeCoordinates[index];
          await storage.createStop({
            routeId: route.id,
            name: `Parada ${i}`,
            latitude: coord[1].toString(),
            longitude: coord[0].toString(),
            isTerminal: false,
            terminalType: ''
          });
          stopsCount++;
        }
      }
      
      // Terminal destino
      const lastCoord = routeCoordinates[routeCoordinates.length - 1];
      await storage.createStop({
        routeId: route.id,
        name: `Terminal Destino (R${routeId})`,
        latitude: lastCoord[1].toString(),
        longitude: lastCoord[0].toString(),
        isTerminal: true,
        terminalType: 'last'
      });
      stopsCount++;
      
      // Actualizar contador de paradas en la ruta
      await storage.updateRoute(route.id, { stopsCount: stopsCount });
      
      console.log(`✅ Creadas ${stopsCount} paradas para la ruta ${routeId} (alternativa ${alternateNum})`);
      
      return { success: true, route, stopsCount };
      
    } catch (error) {
      console.error(`Error procesando ruta ${routeId} (alternativa ${alternateNum}):`, error);
      return { success: false, message: `Error: ${(error as Error).message}` };
    } finally {
      // Limpiar directorio temporal
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log(`Limpiado directorio temporal ${tmpDir}`);
      } catch (error) {
        console.error(`Error limpiando directorio temporal ${tmpDir}:`, error);
      }
    }
  } catch (error) {
    console.error(`Error general procesando ruta ${routeId} (alternativa ${alternateNum}):`, error);
    return { success: false, message: `Error general: ${(error as Error).message}` };
  }
}

/**
 * Procesa todas las rutas alternativas en un rango
 */
async function processAlternateRoutes(startId: number = 34, endId: number = 44) {
  let successCount = 0;
  let errorCount = 0;
  let totalStopsCount = 0;
  
  console.log(`Procesando rutas alternativas desde ${startId} hasta ${endId}...`);
  
  for (let currentRouteId = startId; currentRouteId <= endId; currentRouteId++) {
    console.log(`\n=== Procesando Ruta ${currentRouteId} ===`);
    
    try {
      // Verificar si existe el directorio de la ruta
      const routeDir = path.join(MAPATON_DIR, `${currentRouteId}_circuito`);
      
      if (!fs.existsSync(routeDir)) {
        console.log(`⚠️ Directorio de ruta ${currentRouteId} no encontrado, omitiendo...`);
        continue;
      }
      
      // Verificar si hay subdirectorios ruta_1 o ruta_2
      const hasRuta1 = fs.existsSync(path.join(routeDir, 'ruta_1'));
      const hasRuta2 = fs.existsSync(path.join(routeDir, 'ruta_2'));
      
      // Procesar ruta_1 si existe
      if (hasRuta1) {
        console.log(`Procesando ruta_1 para ruta ${currentRouteId}...`);
        const result = await processAlternateRoute(currentRouteId, 1);
        
        if (result.success && 'route' in result) {
          console.log(`✅ Ruta ${currentRouteId} (alternativa 1) importada con éxito.`);
          successCount++;
          totalStopsCount += result.stopsCount || 0;
        } else {
          console.log(`❌ Error al importar ruta ${currentRouteId} (alternativa 1): ${result.message}`);
          errorCount++;
        }
      }
      
      // Procesar ruta_2 si existe
      if (hasRuta2) {
        console.log(`Procesando ruta_2 para ruta ${currentRouteId}...`);
        const result = await processAlternateRoute(currentRouteId, 2);
        
        if (result.success && 'route' in result) {
          console.log(`✅ Ruta ${currentRouteId} (alternativa 2) importada con éxito.`);
          successCount++;
          totalStopsCount += result.stopsCount || 0;
        } else {
          console.log(`❌ Error al importar ruta ${currentRouteId} (alternativa 2): ${result.message}`);
          errorCount++;
        }
      }
      
      // Si no hay ninguno de los subdirectorios
      if (!hasRuta1 && !hasRuta2) {
        console.log(`⚠️ No se encontraron subdirectorios ruta_1 o ruta_2 para la ruta ${currentRouteId}`);
        errorCount++;
      }
      
    } catch (error) {
      console.error(`Error procesando ruta ${currentRouteId}:`, error);
      errorCount++;
    }
    
    console.log(`Progreso: ${successCount} rutas importadas, ${errorCount} errores, ${totalStopsCount} paradas creadas`);
  }
  
  console.log(`\n=== Procesamiento de rutas alternativas completado ===`);
  console.log(`Total: ${successCount} rutas importadas, ${errorCount} errores, ${totalStopsCount} paradas`);
  
  return {
    success: successCount > 0,
    routesImported: successCount,
    errors: errorCount,
    stopsCreated: totalStopsCount
  };
}

/**
 * Punto de entrada principal
 */
async function main() {
  try {
    // Verificar si se pasó un número de ruta como parámetro
    const args = process.argv.slice(2);
    
    if (args.length >= 2) {
      // Procesar rango de rutas
      const startId = parseInt(args[0], 10);
      const endId = parseInt(args[1], 10);
      
      if (isNaN(startId) || isNaN(endId)) {
        console.error('Los IDs de ruta deben ser números');
        process.exit(1);
      }
      
      await processAlternateRoutes(startId, endId);
    } else if (args.length === 1) {
      // Procesar una sola ruta
      const routeId = parseInt(args[0], 10);
      
      if (isNaN(routeId)) {
        console.error('El ID de ruta debe ser un número');
        process.exit(1);
      }
      
      await processAlternateRoutes(routeId, routeId);
    } else {
      // Procesar todas las rutas alternativas (34-44)
      await processAlternateRoutes();
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error en el proceso principal:', error);
    process.exit(1);
  }
}

// Iniciar ejecución principal directamente
main();