import * as fs from 'fs';
import * as path from 'path';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';
import * as util from 'util';
import { exec } from 'child_process';

// Promisificar exec para usar con async/await
const execAsync = util.promisify(exec);

// Constantes para directorios y archivos
const SHAPEFILES_DIR = './tmp/extracted/shapefiles-mapton-ciudadano';
const PROCESSED_DIR = './tmp/processed';

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

// Lista de rutas representativas a procesar (versión mínima)
const SELECTED_ROUTES = [
  // Una ruta por zona
  { id: 1, folder: '1_circuito', zone: 'centro' },
  { id: 26, folder: '26_circuito', zone: 'norte' },
  { id: 52, folder: '52_circuito', zone: 'sur' },
  { id: 72, folder: '72_circuito', zone: 'este' },
  { id: 95, folder: '95_circuito', zone: 'oeste' }
];

// Función principal para procesar las rutas seleccionadas
async function processSelectedRoutes() {
  console.log('Iniciando procesamiento de rutas representativas Mapaton...');
  
  try {
    // Limpiar la base de datos antes de importar
    console.log('Limpiando base de datos...');
    await db.delete(busStops);
    await db.delete(busRoutes);
    
    console.log(`Procesando ${SELECTED_ROUTES.length} rutas representativas (1 por zona)`);
    
    let successCount = 0;
    let errorCount = 0;
    let totalStops = 0;
    
    for (const route of SELECTED_ROUTES) {
      try {
        console.log(`\nProcesando ruta ${route.id} (${route.folder}, zona: ${route.zone})...`);
        const routePath = path.join(SHAPEFILES_DIR, route.folder);
        
        // Verificar si existe el directorio
        if (!fs.existsSync(routePath)) {
          console.log(`⚠️ Directorio no encontrado: ${routePath}, omitiendo...`);
          errorCount++;
          continue;
        }
        
        // Extraer información de la ruta directamente desde archivos Zip
        const routeZipPath = path.join(routePath, 'route.zip');
        
        if (!fs.existsSync(routeZipPath)) {
          console.log(`⚠️ Archivo no encontrado: ${routeZipPath}, omitiendo...`);
          errorCount++;
          continue;
        }
        
        // Crear directorio de trabajo
        const workDir = path.join(PROCESSED_DIR, `route_${route.id}`);
        if (!fs.existsSync(workDir)) {
          fs.mkdirSync(workDir, { recursive: true });
        }
        
        // Extraer archivo
        await execAsync(`unzip -o "${routeZipPath}" -d "${workDir}"`);
        
        // Buscar archivo .shp
        const shpFiles = findFiles(workDir, '.shp');
        if (shpFiles.length === 0) {
          console.log(`⚠️ No se encontraron archivos .shp para la ruta ${route.id}, omitiendo...`);
          errorCount++;
          continue;
        }
        
        // Convertir a GeoJSON
        const geoJsonPath = path.join(workDir, 'route.geojson');
        await execAsync(`ogr2ogr -f GeoJSON "${geoJsonPath}" "${shpFiles[0]}"`);
        
        if (!fs.existsSync(geoJsonPath)) {
          console.log(`⚠️ No se pudo crear el archivo GeoJSON para la ruta ${route.id}, omitiendo...`);
          errorCount++;
          continue;
        }
        
        // Leer GeoJSON
        const geoJson = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));
        if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
          console.log(`⚠️ GeoJSON inválido para la ruta ${route.id}, omitiendo...`);
          errorCount++;
          continue;
        }
        
        // Extraer coordenadas
        const feature = geoJson.features[0];
        const coordinates = feature.geometry?.coordinates || [];
        
        if (!coordinates || coordinates.length === 0) {
          console.log(`⚠️ No se encontraron coordenadas para la ruta ${route.id}, omitiendo...`);
          errorCount++;
          continue;
        }
        
        // Crear objeto GeoJSON para la ruta
        const routeGeoJSON = {
          type: "Feature",
          properties: {
            id: route.id,
            name: `Ruta ${route.id}`,
            shortName: `R${route.id}`,
            color: zoneColors[route.zone]
          },
          geometry: {
            type: "LineString",
            coordinates: coordinates
          }
        };
        
        // Crear ruta en la base de datos
        const newRoute = await storage.createRoute({
          name: `Ruta ${route.id}`,
          shortName: `R${route.id}`,
          color: zoneColors[route.zone],
          frequency: '10 minutos',
          scheduleStart: '05:30 AM',
          scheduleEnd: '22:30 PM',
          stopsCount: 0,
          approximateTime: '30 minutos',
          zone: route.zone,
          popular: true,
          geoJSON: routeGeoJSON
        });
        
        console.log(`✅ Ruta creada: Ruta ${route.id} (ID: ${newRoute.id}) con ${coordinates.length} puntos`);
        successCount++;
        
        // Generar paradas automáticas
        const stopsCount = await generateStops(newRoute.id, coordinates);
        totalStops += stopsCount;
        console.log(`✅ ${stopsCount} paradas generadas para ruta ${newRoute.id}`);
        
      } catch (error) {
        console.error(`❌ Error procesando ruta ${route.id}:`, error);
        errorCount++;
      }
    }
    
    console.log(`\n=== Procesamiento completado ===`);
    console.log(`Total: ${successCount} rutas importadas, ${errorCount} errores, ${totalStops} paradas`);
    
    return { successCount, errorCount, totalStops };
  } catch (error) {
    console.error('Error en el procesamiento general:', error);
    throw error;
  }
}

// Función simplificada para generar paradas
async function generateStops(routeId: number, coordinates: [number, number][]): Promise<number> {
  try {
    if (!coordinates || coordinates.length < 2) {
      return 0;
    }
    
    const count = 8; // Número fijo de paradas para simplificar
    const stopsCount = Math.min(count, coordinates.length - 2);
    
    // Terminal origen
    const firstCoord = coordinates[0];
    await storage.createStop({
      routeId: routeId,
      name: `Terminal Origen (R${routeId})`,
      latitude: firstCoord[1].toString(),
      longitude: firstCoord[0].toString(),
      isTerminal: true,
      terminalType: 'first'
    });
    
    // Paradas intermedias
    const step = Math.floor(coordinates.length / (stopsCount + 1));
    for (let i = 1; i <= stopsCount; i++) {
      const index = i * step;
      if (index < coordinates.length - 1) {
        const coord = coordinates[index];
        await storage.createStop({
          routeId: routeId,
          name: `Parada ${i}`,
          latitude: coord[1].toString(),
          longitude: coord[0].toString(),
          isTerminal: false,
          terminalType: ''
        });
      }
    }
    
    // Terminal destino
    const lastCoord = coordinates[coordinates.length - 1];
    await storage.createStop({
      routeId: routeId,
      name: `Terminal Destino (R${routeId})`,
      latitude: lastCoord[1].toString(),
      longitude: lastCoord[0].toString(),
      isTerminal: true,
      terminalType: 'last'
    });
    
    return stopsCount + 2; // Paradas intermedias + 2 terminales
  } catch (error) {
    console.error(`Error generando paradas para ruta ${routeId}:`, error);
    return 0;
  }
}

// Función para buscar archivos
function findFiles(dir: string, extension: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, extension));
    } else if (entry.name.endsWith(extension)) {
      results.push(fullPath);
    }
  }
  
  return results;
}

// Ejecutar
async function main() {
  try {
    const result = await processSelectedRoutes();
    console.log('Procesamiento finalizado con éxito:', result);
    process.exit(0);
  } catch (error) {
    console.error('Error fatal en el procesamiento:', error);
    process.exit(1);
  }
}

main();