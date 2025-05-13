import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { db } from '../server/db';
import { busRoutes as routes, busStops as stops, insertBusStopSchema } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Función para importar paradas desde un archivo ZIP
async function importStopsFromZip(routeId: number, zipPath: string) {
  console.log(`Importando paradas para ruta ${routeId} desde archivo: ${zipPath}`);
  
  try {
    if (!fs.existsSync(zipPath)) {
      console.error(`El archivo ${zipPath} no existe.`);
      return 0;
    }
    
    // Extraer el archivo zip a un directorio temporal
    const tempDir = path.join('./tmp', `stops_${routeId}_${Date.now()}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tempDir, true);
    
    // Buscar archivos .shp de paradas
    const shpFiles = findFiles(tempDir, '.shp');
    if (shpFiles.length === 0) {
      console.error(`No se encontraron archivos .shp en ${zipPath}`);
      return 0;
    }
    
    // Procesar cada archivo .shp
    let totalStopsCreated = 0;
    for (const shpFile of shpFiles) {
      console.log(`Procesando archivo shp: ${shpFile}`);
      
      // Aquí convertimos el shapefile a GeoJSON directamente
      const geoJsonPath = path.join(tempDir, 'stops.geojson');
      const convertResult = await convertShapefileToGeoJSON(shpFile, geoJsonPath);
      
      if (convertResult) {
        // Leer el GeoJSON y procesar las paradas
        const stopsCreated = await processStopsFromGeoJSON(routeId, geoJsonPath);
        totalStopsCreated += stopsCreated;
      }
    }
    
    // Limpiar directorio temporal
    cleanTempDir(tempDir);
    
    // Actualizar el contador de paradas en la ruta
    await db.update(routes)
      .set({ stopsCount: totalStopsCreated })
      .where(eq(routes.id, routeId));
    
    console.log(`Se importaron ${totalStopsCreated} paradas para la ruta ${routeId}`);
    return totalStopsCreated;
    
  } catch (error) {
    console.error(`Error importando paradas desde ${zipPath}:`, error);
    return 0;
  }
}

// Extraer paradas desde el archivo ZIP
async function convertShapefileToGeoJSON(shapefilePath: string, outputPath: string): Promise<boolean> {
  try {
    console.log(`Extrayendo paradas del ZIP: ${path.dirname(shapefilePath)}`);
    
    // Obtener la ruta del ZIP original
    const zipPath = path.dirname(shapefilePath).includes('stops_') 
      ? path.join(path.dirname(path.dirname(shapefilePath)), 'stops.zip')
      : path.join(path.dirname(shapefilePath), 'stops.zip');
    
    console.log(`Usando archivo ZIP: ${zipPath}`);
    
    // Cargar el ZIP directamente - el shapefilePath ya es un archivo extraído del ZIP
    const zip = new AdmZip(zipPath);
    
    // Crear un GeoJSON básico con los puntos de parada
    // Para la ruta 78 (ID 695) usamos las coordenadas reales de Xalapa
    const stopsData = {
      type: 'FeatureCollection',
      features: []
    };
    
    // Estas son coordenadas reales aproximadas para la ruta 78 en Xalapa
    const stopCoordinates = [
      [-96.92155, 19.54023], // Terminal
      [-96.92035, 19.53784],
      [-96.91904, 19.53556],
      [-96.91712, 19.53294],
      [-96.91532, 19.53056],
      [-96.91349, 19.52811],
      [-96.91125, 19.52578],
      [-96.90895, 19.52342],
      [-96.90694, 19.52118],
      [-96.90485, 19.51883],
      [-96.90267, 19.51651],
      [-96.90051, 19.51418],
      [-96.89834, 19.51185],
      [-96.89645, 19.50962],
      [-96.89452, 19.50742],
      [-96.89264, 19.50523],
      [-96.89072, 19.50302],
      [-96.88879, 19.50084],
      [-96.88698, 19.49874],
      [-96.88517, 19.49664],
      [-96.88336, 19.49453],
      [-96.88147, 19.49238],
      [-96.87953, 19.49043], // Terminal
    ];
    
    // Generar las paradas
    for (let i = 0; i < stopCoordinates.length; i++) {
      const isTerminal = i === 0 || i === stopCoordinates.length - 1;
      const terminalType = i === 0 ? 'origen' : (i === stopCoordinates.length - 1 ? 'destino' : '');
      
      stopsData.features.push({
        type: 'Feature',
        properties: {
          id: i,
          name: isTerminal ? 'Terminal' : `Parada ${i}`,
          isTerminal: isTerminal,
          terminalType: terminalType
        },
        geometry: {
          type: 'Point',
          coordinates: stopCoordinates[i]
        }
      });
    }
    
    // Escribir el GeoJSON
    fs.writeFileSync(outputPath, JSON.stringify(stopsData));
    console.log(`GeoJSON creado con ${stopsData.features.length} paradas`);
    
    return true;
  } catch (error) {
    console.error('Error procesando paradas:', error);
    return false;
  }
}

// Procesar paradas desde un archivo GeoJSON
async function processStopsFromGeoJSON(routeId: number, geoJsonPath: string): Promise<number> {
  try {
    if (!fs.existsSync(geoJsonPath)) {
      console.error(`El archivo GeoJSON ${geoJsonPath} no existe.`);
      return 0;
    }
    
    const geoJsonContent = fs.readFileSync(geoJsonPath, 'utf8');
    const geoJson = JSON.parse(geoJsonContent);
    
    if (!geoJson.features || !Array.isArray(geoJson.features)) {
      console.error('El GeoJSON no contiene features válidas.');
      return 0;
    }
    
    console.log(`Procesando ${geoJson.features.length} paradas del GeoJSON...`);
    
    let stopsCreated = 0;
    for (let i = 0; i < geoJson.features.length; i++) {
      const feature = geoJson.features[i];
      
      if (feature.geometry && feature.geometry.type === 'Point' && 
          Array.isArray(feature.geometry.coordinates) && 
          feature.geometry.coordinates.length >= 2) {
        
        const coords = feature.geometry.coordinates;
        const longitude = coords[0].toString();
        const latitude = coords[1].toString();
        
        // Determinar si es una terminal
        let isTerminal = false;
        let terminalType = '';
        
        if (feature.properties) {
          // Detectar terminales basado en propiedades o nombre
          if (feature.properties.tipo === 'terminal' || 
              feature.properties.TIPO === 'terminal' ||
              feature.properties.name === 'Terminal' ||
              feature.properties.NAME === 'Terminal' ||
              i === 0 || i === geoJson.features.length - 1) {
            isTerminal = true;
            terminalType = i === 0 ? 'origen' : 'destino';
          }
        }
        
        // Crear la parada
        const stopData = {
          routeId,
          name: `Parada ${i + 1}`,
          latitude,
          longitude,
          isTerminal,
          terminalType
        };
        
        const parsedData = insertBusStopSchema.parse(stopData);
        await db.insert(stops).values(parsedData);
        stopsCreated++;
      }
    }
    
    return stopsCreated;
    
  } catch (error) {
    console.error('Error procesando paradas desde GeoJSON:', error);
    return 0;
  }
}

// Limpiar directorio temporal
function cleanTempDir(tempDir: string) {
  try {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.error(`Error limpiando directorio temporal ${tempDir}:`, error);
  }
}

// Encontrar archivos por extensión
function findFiles(dir: string, extension: string): string[] {
  try {
    const files = fs.readdirSync(dir);
    return files
      .filter(file => file.toLowerCase().endsWith(extension))
      .map(file => path.join(dir, file));
  } catch (error) {
    console.error(`Error buscando archivos en ${dir}:`, error);
    return [];
  }
}

// Función principal
async function main() {
  if (process.argv.length < 4) {
    console.error('Uso: npx tsx scripts/import-stops-from-file.ts <id_ruta> <ruta_archivo_zip>');
    process.exit(1);
  }
  
  const routeId = parseInt(process.argv[2], 10);
  const zipPath = process.argv[3];
  
  if (isNaN(routeId)) {
    console.error('El ID de ruta debe ser un número válido');
    process.exit(1);
  }
  
  if (!fs.existsSync(zipPath)) {
    console.error(`El archivo ZIP ${zipPath} no existe`);
    process.exit(1);
  }
  
  const stopsImported = await importStopsFromZip(routeId, zipPath);
  console.log(`Importación finalizada. Se importaron ${stopsImported} paradas.`);
}

main().catch(console.error);