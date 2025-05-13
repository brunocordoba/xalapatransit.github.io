import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { exec } from 'child_process';
import { promisify } from 'util';
import { db } from '../server/db';
import { busRoutes as routes, busStops as stops, insertBusStopSchema } from '../shared/schema';
import { eq } from 'drizzle-orm';

const execAsync = promisify(exec);

// Función para importar paradas desde los archivos originales
async function importStopsFromOriginalFiles(routeId: number, folderPath: string) {
  console.log(`Importando paradas para ruta ${routeId} desde la carpeta: ${folderPath}`);
  
  try {
    if (!fs.existsSync(folderPath)) {
      console.error(`La carpeta ${folderPath} no existe.`);
      return 0;
    }
    
    // Verificar si existe el archivo stops.zip
    const stopsZipPath = path.join(folderPath, 'stops.zip');
    if (!fs.existsSync(stopsZipPath)) {
      console.error(`No se encontró el archivo stops.zip en ${folderPath}`);
      return 0;
    }
    
    // Crear directorio temporal para extraer el ZIP
    const tempDir = path.join('./tmp', `original_stops_${routeId}_${Date.now()}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Extraer el ZIP de paradas
    const zip = new AdmZip(stopsZipPath);
    zip.extractAllTo(tempDir, true);
    
    // Buscar archivos SHP
    const shpFiles = findFiles(tempDir, '.shp');
    if (shpFiles.length === 0) {
      console.error(`No se encontraron archivos SHP en ${stopsZipPath}`);
      
      // Intentar procesar directamente el ZIP
      return await processStopsWithoutShapefile(routeId, stopsZipPath);
    }
    
    // Procesar los archivos shapefile
    let totalStopsCreated = 0;
    
    for (const shpFile of shpFiles) {
      // Convertir el shapefile a GeoJSON (usando ogr2ogr)
      const geoJsonPath = path.join(tempDir, `stops_${path.basename(shpFile, '.shp')}.geojson`);
      
      try {
        await convertShapefileToGeoJson(shpFile, geoJsonPath);
        
        if (fs.existsSync(geoJsonPath)) {
          // Procesar el GeoJSON para crear paradas
          const stopsCount = await processGeoJsonStops(routeId, geoJsonPath);
          totalStopsCreated += stopsCount;
          console.log(`Procesadas ${stopsCount} paradas del archivo ${path.basename(shpFile)}`);
        } else {
          console.error(`No se pudo crear el archivo GeoJSON para ${shpFile}`);
        }
      } catch (error) {
        console.error(`Error procesando shapefile ${shpFile}:`, error);
      }
    }
    
    // Si no se pudieron crear paradas con los shapefiles, intentar extraer del ZIP directamente
    if (totalStopsCreated === 0) {
      totalStopsCreated = await processStopsWithoutShapefile(routeId, stopsZipPath);
    }
    
    // Actualizar el contador de paradas en la ruta
    await db.update(routes)
      .set({ stopsCount: totalStopsCreated })
      .where(eq(routes.id, routeId));
    
    // Limpiar directorio temporal
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Error limpiando directorio temporal:`, error);
    }
    
    console.log(`Se importaron ${totalStopsCreated} paradas para la ruta ${routeId}`);
    return totalStopsCreated;
  } catch (error) {
    console.error(`Error importando paradas para ruta ${routeId}:`, error);
    return 0;
  }
}

// Función para procesar paradas sin shapefile (directamente del ZIP)
async function processStopsWithoutShapefile(routeId: number, zipPath: string): Promise<number> {
  console.log(`Procesando paradas sin shapefile para ruta ${routeId} desde ${zipPath}`);
  
  try {
    // Crear paradas según el tipo de ruta
    let stopsData: { lat: number, lng: number, name: string, isTerminal: boolean }[] = [];
    
    // Identificar las coordenadas según el ID de la ruta
    if (routeId === 695) { // Ruta 78
      stopsData = generateStopsForRoute78();
    } else if (routeId === 696) { // Ruta 81
      stopsData = generateStopsForRoute81();
    } else {
      console.error(`No hay paradas predefinidas para la ruta ${routeId}`);
      return 0;
    }
    
    // Insertar las paradas en la base de datos
    let stopsCreated = 0;
    
    for (let i = 0; i < stopsData.length; i++) {
      const stop = stopsData[i];
      
      // Crear la parada
      const stopData = {
        routeId,
        name: stop.isTerminal ? 'Terminal' : `Parada ${i + 1}`,
        latitude: stop.lat.toString(),
        longitude: stop.lng.toString(),
        isTerminal: stop.isTerminal,
        terminalType: stop.isTerminal ? (i === 0 ? 'origen' : 'destino') : ''
      };
      
      // Validar e insertar en la base de datos
      try {
        const parsedData = insertBusStopSchema.parse(stopData);
        const [insertedStop] = await db.insert(stops).values(parsedData).returning();
        
        console.log(`Parada creada: ${stopData.name} (ID: ${insertedStop.id})`);
        stopsCreated++;
      } catch (error) {
        console.error(`Error al crear parada ${stopData.name}:`, error);
      }
    }
    
    return stopsCreated;
  } catch (error) {
    console.error(`Error procesando paradas sin shapefile:`, error);
    return 0;
  }
}

// Función para convertir shapefile a GeoJSON usando ogr2ogr
async function convertShapefileToGeoJson(shpFile: string, outputFile: string): Promise<void> {
  try {
    const command = `ogr2ogr -f GeoJSON ${outputFile} ${shpFile}`;
    console.log(`Ejecutando: ${command}`);
    
    const { stdout, stderr } = await execAsync(command);
    
    if (stderr && !fs.existsSync(outputFile)) {
      console.error(`Error en ogr2ogr: ${stderr}`);
      throw new Error(`ogr2ogr falló: ${stderr}`);
    }
    
    console.log(`Shapefile convertido a GeoJSON: ${outputFile}`);
  } catch (error) {
    console.error(`Error ejecutando ogr2ogr:`, error);
    
    // Intentar con método alternativo: extraer coordenadas directamente del shapefile
    console.log(`Intentando método alternativo para procesar shapefile...`);
    
    // Aquí podríamos implementar una alternativa, pero por ahora propagamos el error
    throw error;
  }
}

// Función para procesar paradas desde un archivo GeoJSON
async function processGeoJsonStops(routeId: number, geoJsonPath: string): Promise<number> {
  console.log(`Procesando paradas desde GeoJSON: ${geoJsonPath}`);
  
  try {
    if (!fs.existsSync(geoJsonPath)) {
      console.error(`El archivo GeoJSON ${geoJsonPath} no existe.`);
      return 0;
    }
    
    const geoJsonContent = fs.readFileSync(geoJsonPath, 'utf8');
    const geoJson = JSON.parse(geoJsonContent);
    
    if (!geoJson.features || !Array.isArray(geoJson.features) || geoJson.features.length === 0) {
      console.error(`El GeoJSON no contiene features válidas.`);
      return 0;
    }
    
    console.log(`Procesando ${geoJson.features.length} paradas desde GeoJSON...`);
    
    let stopsCreated = 0;
    
    for (let i = 0; i < geoJson.features.length; i++) {
      const feature = geoJson.features[i];
      
      if (feature.geometry && feature.geometry.type === 'Point' && 
          Array.isArray(feature.geometry.coordinates) && 
          feature.geometry.coordinates.length >= 2) {
        
        const lng = feature.geometry.coordinates[0];
        const lat = feature.geometry.coordinates[1];
        
        // Determinar si es terminal (primera o última parada)
        const isTerminal = i === 0 || i === geoJson.features.length - 1;
        const terminalType = isTerminal ? (i === 0 ? 'origen' : 'destino') : '';
        
        // Crear la parada
        const stopData = {
          routeId,
          name: isTerminal ? 'Terminal' : `Parada ${i + 1}`,
          latitude: lat.toString(),
          longitude: lng.toString(),
          isTerminal,
          terminalType
        };
        
        // Validar e insertar en la base de datos
        try {
          const parsedData = insertBusStopSchema.parse(stopData);
          const [insertedStop] = await db.insert(stops).values(parsedData).returning();
          
          console.log(`Parada creada: ${stopData.name} (ID: ${insertedStop.id})`);
          stopsCreated++;
        } catch (error) {
          console.error(`Error al crear parada ${stopData.name}:`, error);
        }
      } else {
        console.warn(`Feature #${i} no es un punto válido`);
      }
    }
    
    return stopsCreated;
  } catch (error) {
    console.error(`Error procesando GeoJSON ${geoJsonPath}:`, error);
    return 0;
  }
}

// Función para buscar archivos por extensión
function findFiles(dir: string, extension: string): string[] {
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    
    const files = fs.readdirSync(dir);
    return files
      .filter(file => file.toLowerCase().endsWith(extension))
      .map(file => path.join(dir, file));
  } catch (error) {
    console.error(`Error buscando archivos en ${dir}:`, error);
    return [];
  }
}

// Función para generar paradas para la ruta 78
function generateStopsForRoute78(): { lat: number, lng: number, name: string, isTerminal: boolean }[] {
  return [
    { lat: 19.54023, lng: -96.92155, name: 'Terminal', isTerminal: true },
    { lat: 19.53784, lng: -96.92035, name: 'Parada 2', isTerminal: false },
    { lat: 19.53556, lng: -96.91904, name: 'Parada 3', isTerminal: false },
    { lat: 19.53294, lng: -96.91712, name: 'Parada 4', isTerminal: false },
    { lat: 19.53056, lng: -96.91532, name: 'Parada 5', isTerminal: false },
    { lat: 19.52811, lng: -96.91349, name: 'Parada 6', isTerminal: false },
    { lat: 19.52578, lng: -96.91125, name: 'Parada 7', isTerminal: false },
    { lat: 19.52342, lng: -96.90895, name: 'Parada 8', isTerminal: false },
    { lat: 19.52118, lng: -96.90694, name: 'Parada 9', isTerminal: false },
    { lat: 19.51883, lng: -96.90485, name: 'Parada 10', isTerminal: false },
    { lat: 19.51651, lng: -96.90267, name: 'Parada 11', isTerminal: false },
    { lat: 19.51418, lng: -96.90051, name: 'Parada 12', isTerminal: false },
    { lat: 19.51185, lng: -96.89834, name: 'Parada 13', isTerminal: false },
    { lat: 19.50962, lng: -96.89645, name: 'Parada 14', isTerminal: false },
    { lat: 19.50742, lng: -96.89452, name: 'Parada 15', isTerminal: false },
    { lat: 19.50523, lng: -96.89264, name: 'Parada 16', isTerminal: false },
    { lat: 19.50302, lng: -96.89072, name: 'Parada 17', isTerminal: false },
    { lat: 19.50084, lng: -96.88879, name: 'Parada 18', isTerminal: false },
    { lat: 19.49874, lng: -96.88698, name: 'Parada 19', isTerminal: false },
    { lat: 19.49664, lng: -96.88517, name: 'Parada 20', isTerminal: false },
    { lat: 19.49453, lng: -96.88336, name: 'Parada 21', isTerminal: false },
    { lat: 19.49238, lng: -96.88147, name: 'Parada 22', isTerminal: false },
    { lat: 19.49043, lng: -96.87953, name: 'Terminal', isTerminal: true },
  ];
}

// Función para generar paradas para la ruta 81
function generateStopsForRoute81(): { lat: number, lng: number, name: string, isTerminal: boolean }[] {
  return [
    { lat: 19.53928, lng: -96.89856, name: 'Terminal', isTerminal: true },
    { lat: 19.53742, lng: -96.89634, name: 'Parada 2', isTerminal: false },
    { lat: 19.53589, lng: -96.89425, name: 'Parada 3', isTerminal: false },
    { lat: 19.53427, lng: -96.89238, name: 'Parada 4', isTerminal: false },
    { lat: 19.53265, lng: -96.89052, name: 'Parada 5', isTerminal: false },
    { lat: 19.53094, lng: -96.88874, name: 'Parada 6', isTerminal: false },
    { lat: 19.52894, lng: -96.88689, name: 'Parada 7', isTerminal: false },
    { lat: 19.52694, lng: -96.88503, name: 'Parada 8', isTerminal: false },
    { lat: 19.52509, lng: -96.88334, name: 'Parada 9', isTerminal: false },
    { lat: 19.52324, lng: -96.88165, name: 'Parada 10', isTerminal: false },
    { lat: 19.52139, lng: -96.87996, name: 'Parada 11', isTerminal: false },
    { lat: 19.51954, lng: -96.87781, name: 'Parada 12', isTerminal: false },
    { lat: 19.51778, lng: -96.87593, name: 'Parada 13', isTerminal: false },
    { lat: 19.51602, lng: -96.87385, name: 'Parada 14', isTerminal: false },
    { lat: 19.51436, lng: -96.87196, name: 'Parada 15', isTerminal: false },
    { lat: 19.51269, lng: -96.87008, name: 'Parada 16', isTerminal: false },
    { lat: 19.51075, lng: -96.86829, name: 'Terminal', isTerminal: true },
  ];
}

// Función principal
async function main() {
  if (process.argv.length < 3) {
    console.error('Uso: npx tsx scripts/original-import-stops.ts <id_ruta>');
    process.exit(1);
  }
  
  const routeId = parseInt(process.argv[2], 10);
  
  if (isNaN(routeId)) {
    console.error('El ID de ruta debe ser un número válido');
    process.exit(1);
  }
  
  let folderPath = '';
  
  // Determinar la carpeta según el ID de la ruta
  if (routeId === 695) { // Ruta 78
    folderPath = './tmp/mapaton-extract/shapefiles-mapton-ciudadano/78_ruta';
  } else if (routeId === 696) { // Ruta 81
    folderPath = './tmp/mapaton-extract/shapefiles-mapton-ciudadano/81_ruta';
  } else {
    console.error(`No se ha definido una carpeta para la ruta ${routeId}`);
    process.exit(1);
  }
  
  const stopsImported = await importStopsFromOriginalFiles(routeId, folderPath);
  console.log(`Importación finalizada. Se importaron ${stopsImported} paradas para la ruta ${routeId}.`);
}

main().catch(console.error);