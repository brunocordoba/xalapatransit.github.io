/**
 * Script para importar una ruta alternativa (35-44) que tiene estructura diferente
 * Uso: tsx scripts/importar-ruta-directamente.ts <numero_ruta> <numero_alternativa>
 */
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
const SHAPEFILES_DIR = './tmp/mapaton-extract/shapefiles-mapton-ciudadano';
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

/**
 * Determina la zona de una ruta según su ID
 */
function determineZone(routeId: number): string {
  if (routeId <= 20) {
    return 'norte';
  } else if (routeId <= 40) {
    return 'sur';
  } else if (routeId <= 60) {
    return 'este';
  } else if (routeId <= 80) {
    return 'oeste';
  } else {
    return 'centro';
  }
}

/**
 * Función principal para importar la ruta
 */
async function importarRutaAlternativa() {
  try {
    // Obtener parámetros de línea de comandos
    const routeId = parseInt(process.argv[2], 10);
    const alternateNum = parseInt(process.argv[3], 10);
    
    if (isNaN(routeId) || isNaN(alternateNum) || alternateNum < 1 || alternateNum > 2) {
      console.error('Uso: tsx scripts/importar-ruta-directamente.ts <numero_ruta> <numero_alternativa>');
      console.error('Donde <numero_alternativa> es 1 o 2');
      process.exit(1);
    }
    
    console.log(`Procesando ruta ${routeId} alternativa ${alternateNum}...`);
    
    // Verificar si la ruta ya existe
    const routeName = `Ruta ${routeId} (Alternativa ${alternateNum})`;
    const existingRoutes = await db.query.busRoutes.findMany({
      where: (busRoutes, { eq }) => eq(busRoutes.name, routeName)
    });
    
    if (existingRoutes.length > 0) {
      console.log(`La ruta ${routeName} ya existe en la base de datos, omitiendo...`);
      return { success: true, route: existingRoutes[0] };
    }
    
    // Construir ruta al directorio
    const circuitDir = path.join(SHAPEFILES_DIR, `${routeId}_circuito`);
    const routeDir = path.join(SHAPEFILES_DIR, `${routeId}_ruta`);
    
    let baseDir: string;
    
    // Determinar directorio base
    if (fs.existsSync(circuitDir)) {
      baseDir = circuitDir;
    } else if (fs.existsSync(routeDir)) {
      baseDir = routeDir;
    } else {
      throw new Error(`No se encontró directorio para la ruta ${routeId}`);
    }
    
    // Determinar ruta al archivo de ruta
    const alternatePath = path.join(baseDir, `ruta_${alternateNum}`);
    const routeZipPath = path.join(alternatePath, 'route.zip');
    
    if (!fs.existsSync(alternatePath)) {
      throw new Error(`No se encontró directorio ruta_${alternateNum} para la ruta ${routeId}`);
    }
    
    if (!fs.existsSync(routeZipPath)) {
      throw new Error(`No se encontró archivo route.zip en la ruta ${routeId}/ruta_${alternateNum}`);
    }
    
    // Crear directorios temporales para extracción
    const tmpDir = path.join(PROCESSED_DIR, `route_${routeId}_alt${alternateNum}`);
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    
    const routeShpDir = path.join(tmpDir, 'route');
    if (!fs.existsSync(routeShpDir)) {
      fs.mkdirSync(routeShpDir, { recursive: true });
    }
    
    const stopsShpDir = path.join(tmpDir, 'stops');
    if (!fs.existsSync(stopsShpDir)) {
      fs.mkdirSync(stopsShpDir, { recursive: true });
    }
    
    try {
      // Extraer archivo de ruta
      await execAsync(`unzip -o "${routeZipPath}" -d "${routeShpDir}"`);
      
      // Buscar archivo .shp para la ruta
      const routeShpFiles = findFiles(routeShpDir, '.shp');
      if (routeShpFiles.length === 0) {
        throw new Error(`No se encontraron archivos .shp en ${routeShpDir}`);
      }
      
      // Convertir shapefile de ruta a GeoJSON
      const routeShpFile = routeShpFiles[0];
      const routeGeoJsonFile = path.join(tmpDir, 'route.geojson');
      
      await execAsync(`ogr2ogr -f GeoJSON "${routeGeoJsonFile}" "${routeShpFile}"`);
      
      if (!fs.existsSync(routeGeoJsonFile)) {
        throw new Error(`Error al convertir shapefile a GeoJSON: ${routeShpFile}`);
      }
      
      // Leer archivo GeoJSON y extraer datos
      const routeGeoJson = JSON.parse(fs.readFileSync(routeGeoJsonFile, 'utf8'));
      
      if (!routeGeoJson || !routeGeoJson.features || routeGeoJson.features.length === 0) {
        throw new Error(`No se encontraron características en el GeoJSON de la ruta`);
      }
      
      // Usar primera característica como ruta
      const routeFeature = routeGeoJson.features[0];
      const routeCoordinates = routeFeature.geometry?.coordinates || [];
      
      if (!routeCoordinates || routeCoordinates.length === 0) {
        throw new Error(`No se encontraron coordenadas en la ruta`);
      }
      
      // Determinar zona y crear nombre
      const zone = determineZone(routeId);
      const routePrefix = `Ruta ${routeId}`;
      const alternateLabel = `Alternativa ${alternateNum}`;
      
      // Generar nombre completo de la ruta
      const routeName = `${routePrefix} (${alternateLabel})`;
      const shortName = `R${routeId}-${alternateNum}`;
      const color = zoneColors[zone];
      
      // Crear objeto GeoJSON para la ruta
      const finalRouteGeoJSON = {
        type: "Feature",
        properties: {
          id: routeId * 10 + alternateNum,
          name: routeName,
          shortName: shortName,
          color: color
        },
        geometry: {
          type: "LineString",
          coordinates: routeCoordinates
        }
      };
      
      // Generar datos complementarios
      const approximateTime = approximateTimeFromPoints(routeCoordinates.length);
      const frequency = getRandomFrequency();
      
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
      
      // Procesar paradas si existen
      let stopsCount = 0;
      const stopsZipPath = path.join(alternatePath, 'stops.zip');
      
      try {
        if (fs.existsSync(stopsZipPath)) {
          // Extraer archivo de paradas
          await execAsync(`unzip -o "${stopsZipPath}" -d "${stopsShpDir}"`);
          
          // Buscar archivo .shp para las paradas
          const stopsShpFiles = findFiles(stopsShpDir, '.shp');
          
          if (stopsShpFiles.length > 0) {
            // Convertir shapefile de paradas a GeoJSON
            const stopsShpFile = stopsShpFiles[0];
            const stopsGeoJsonFile = path.join(tmpDir, 'stops.geojson');
            
            await execAsync(`ogr2ogr -f GeoJSON "${stopsGeoJsonFile}" "${stopsShpFile}"`);
            
            if (fs.existsSync(stopsGeoJsonFile)) {
              // Leer archivo GeoJSON y extraer datos
              const stopsGeoJson = JSON.parse(fs.readFileSync(stopsGeoJsonFile, 'utf8'));
              
              if (stopsGeoJson && stopsGeoJson.features && stopsGeoJson.features.length > 0) {
                // Crear paradas
                stopsCount = await createStopsFromGeoJSON(route.id, stopsGeoJson);
                console.log(`✅ Creadas ${stopsCount} paradas para la ruta ${route.id}`);
              }
            }
          }
        } else {
          console.log(`No se encontró archivo stops.zip para ruta ${routeId} alternativa ${alternateNum}`);
        }
      } catch (error) {
        console.error(`Error procesando paradas para ruta ${routeId} alternativa ${alternateNum}:`, error);
        // Continuamos aunque haya error en las paradas
      }
      
      return { success: true, route, stopsCount };
    } catch (error) {
      console.error(`Error procesando ruta ${routeId} alternativa ${alternateNum}:`, error);
      throw error;
    }
  } catch (error) {
    console.error('Error en la importación:', error);
    return { success: false, error };
  }
}

// Función para crear paradas desde GeoJSON
async function createStopsFromGeoJSON(routeId: number, stopsGeoJson: any): Promise<number> {
  try {
    const features = stopsGeoJson.features || [];
    if (features.length === 0) {
      return 0;
    }
    
    let count = 0;
    
    // Primera parada es terminal origen
    const firstStop = features[0];
    const firstCoord = firstStop.geometry.coordinates;
    
    await storage.createStop({
      routeId: routeId,
      name: `Terminal Origen`,
      latitude: firstCoord[1].toString(),
      longitude: firstCoord[0].toString(),
      isTerminal: true,
      terminalType: 'first'
    });
    count++;
    
    // Paradas intermedias
    for (let i = 1; i < features.length - 1; i++) {
      const stop = features[i];
      const coord = stop.geometry.coordinates;
      
      await storage.createStop({
        routeId: routeId,
        name: `Parada ${i}`,
        latitude: coord[1].toString(),
        longitude: coord[0].toString(),
        isTerminal: false,
        terminalType: 'middle'
      });
      count++;
    }
    
    // Última parada es terminal destino
    if (features.length > 1) {
      const lastStop = features[features.length - 1];
      const lastCoord = lastStop.geometry.coordinates;
      
      await storage.createStop({
        routeId: routeId,
        name: `Terminal Destino`,
        latitude: lastCoord[1].toString(),
        longitude: lastCoord[0].toString(),
        isTerminal: true,
        terminalType: 'last'
      });
      count++;
    }
    
    return count;
  } catch (error) {
    console.error(`Error creando paradas:`, error);
    return 0;
  }
}

// Función para buscar archivos en un directorio
function findFiles(dir: string, extension: string): string[] {
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    
    const files = fs.readdirSync(dir);
    return files
      .filter(file => file.toLowerCase().endsWith(extension.toLowerCase()))
      .map(file => path.join(dir, file));
  } catch (error) {
    console.error(`Error buscando archivos en ${dir}:`, error);
    return [];
  }
}

// Genera un tiempo aproximado basado en la cantidad de puntos
function approximateTimeFromPoints(points: number): string {
  const minutes = Math.max(10, Math.round(points / 10));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${remainingMinutes}min`;
  } else {
    return `${minutes}min`;
  }
}

// Genera una frecuencia aleatoria
function getRandomFrequency(): string {
  const frequencies = [
    '5-10 min',
    '10-15 min',
    '15-20 min',
    '20-30 min'
  ];
  
  const randomIndex = Math.floor(Math.random() * frequencies.length);
  return frequencies[randomIndex];
}

// Ejecutar función principal
importarRutaAlternativa()
  .then(result => {
    if (result.success) {
      console.log('Importación completada con éxito');
      process.exit(0);
    } else {
      console.error('Error en la importación:', result.error);
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });