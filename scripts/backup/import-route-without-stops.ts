import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import fetch from 'node-fetch';
import { db } from '../server/db';
import { busRoutes as routes, busStops as stops, insertBusRouteSchema } from '../shared/schema';

// Función principal para importar una ruta específica sin generar paradas automáticas
async function importRouteWithoutStops(routeId: number) {
  console.log(`Iniciando importación de la ruta ${routeId} sin paradas automáticas...`);
  
  try {
    // Encontrar la carpeta de la ruta
    const baseDir = './tmp/mapaton-extract/shapefiles-mapton-ciudadano';
    const routeFolders = [
      `${routeId}_ruta`,
      `${routeId}_circuito`,
    ];
    
    let routeFolder = null;
    for (const folder of routeFolders) {
      const fullPath = path.join(baseDir, folder);
      if (fs.existsSync(fullPath)) {
        routeFolder = folder;
        break;
      }
    }
    
    if (!routeFolder) {
      console.error(`No se encontró carpeta para la ruta ${routeId}`);
      return;
    }
    
    console.log(`Procesando ${routeFolder}...`);
    
    // Procesar la ruta (sin procesar paradas)
    const routesDir = path.join(baseDir, routeFolder, 'routes');
    if (!fs.existsSync(routesDir)) {
      console.error(`No se encontró directorio de rutas para ${routeFolder}`);
      return;
    }
    
    const shapeFiles = findFiles(routesDir, '.shp');
    if (shapeFiles.length === 0) {
      const zipFiles = findFiles(routesDir, '.zip');
      
      if (zipFiles.length === 0) {
        console.error(`No se encontraron archivos .shp o .zip para ${routeFolder}`);
        return;
      }
      
      // Crear ruta directamente desde el archivo ZIP sin intentar generar paradas
      for (const zipFile of zipFiles) {
        const routeCoordinates = await processRouteZip(routeId, zipFile);
        if (routeCoordinates.length > 0) {
          const routeRecord = await createRoute(routeId, routeCoordinates);
          console.log(`✅ Ruta ${routeId} (directa) importada con éxito. ID: ${routeRecord.id} - Sin paradas`);
        }
      }
    } else {
      console.error(`Se encontraron archivos .shp, pero este script sólo maneja .zip`);
      return;
    }
    
  } catch (error) {
    console.error(`Error importando ruta ${routeId}:`, error);
  }
}

// Función para procesar un archivo ZIP de ruta
async function processRouteZip(
  routeId: number, 
  zipPath: string
): Promise<[number, number][]> {
  try {
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    
    // Buscar archivo .kml
    const kmlEntry = zipEntries.find(entry => entry.name.endsWith('.kml'));
    if (!kmlEntry) {
      console.error(`No se encontró archivo .kml en ${zipPath}`);
      return [];
    }
    
    // Extraer y procesar el archivo KML
    const kmlContent = kmlEntry.getData().toString('utf8');
    
    // Extraer coordenadas del KML
    const coordinates = extractCoordinatesFromKML(kmlContent);
    if (coordinates.length === 0) {
      console.error(`No se encontraron coordenadas válidas en el KML de ${zipPath}`);
      return [];
    }
    
    console.log(`✅ Extraídas ${coordinates.length} coordenadas para la ruta ${routeId}`);
    return coordinates;
    
  } catch (error) {
    console.error(`Error procesando ZIP ${zipPath}:`, error);
    return [];
  }
}

// Función para extraer coordenadas de un archivo KML
function extractCoordinatesFromKML(kmlContent: string): [number, number][] {
  const coordinates: [number, number][] = [];
  
  // Encontrar la sección de coordenadas
  const coordsMatch = kmlContent.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
  if (!coordsMatch || !coordsMatch[1]) {
    return coordinates;
  }
  
  const coordsStr = coordsMatch[1].trim();
  const coordPairs = coordsStr.split(/\s+/);
  
  for (const pair of coordPairs) {
    const [lngStr, latStr] = pair.split(',');
    const lng = parseFloat(lngStr);
    const lat = parseFloat(latStr);
    
    if (!isNaN(lng) && !isNaN(lat)) {
      coordinates.push([lng, lat]);
    }
  }
  
  return coordinates;
}

// Función para crear una ruta en la base de datos
async function createRoute(
  routeId: number, 
  coordinates: [number, number][]
) {
  // Determinar la zona basado en el ID de la ruta
  const zone = determineZone(routeId);
  
  // Datos para la inserción de la ruta
  const routeData = {
    name: `Ruta ${routeId}`,
    shortName: `R${routeId}`,
    color: getRandomColor(),
    frequency: getRandomFrequency(),
    scheduleStart: '05:00',
    scheduleEnd: '22:00',
    stopsCount: 0,
    approximateTime: approximateTimeFromPoints(coordinates.length),
    zone,
    geoJSON: {
      type: "Feature",
      properties: {
        id: routeId,
        name: `Ruta ${routeId}`,
        shortName: `R${routeId}`,
        color: getRandomColor()
      },
      geometry: {
        type: "LineString",
        coordinates
      }
    },
  };
  
  // Validar los datos con el esquema de inserción
  const parsedData = insertBusRouteSchema.parse(routeData);
  
  // Insertar la ruta en la base de datos
  const [insertedRoute] = await db.insert(routes).values(parsedData).returning();
  
  console.log(`✅ Ruta creada: ${routeData.name} (ID: ${insertedRoute.id}) con ${coordinates.length} puntos`);
  
  return insertedRoute;
}

// Función para determinar la zona basado en el ID de la ruta
function determineZone(routeId: number): string {
  if (routeId <= 20) return 'Centro';
  if (routeId <= 40) return 'Norte';
  if (routeId <= 60) return 'Sur';
  if (routeId <= 80) return 'Este';
  return 'Oeste';
}

// Función para generar un color aleatorio para la ruta
function getRandomColor(): string {
  const colors = [
    '#FF5733', '#33FF57', '#3357FF', '#FF33F5', '#F5FF33',
    '#33FFF5', '#F533FF', '#FF3333', '#33FF33', '#3333FF',
    '#FFAA33', '#33FFAA', '#AA33FF', '#FF33AA', '#AAFF33',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Función para calcular la distancia aproximada de la ruta
function calculateDistance(coordinates: [number, number][]): number {
  if (coordinates.length < 2) return 0;
  
  let totalDistance = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [lng1, lat1] = coordinates[i - 1];
    const [lng2, lat2] = coordinates[i];
    
    totalDistance += haversineDistance(lat1, lng1, lat2, lng2);
  }
  
  return Math.round(totalDistance * 10) / 10; // Redondear a 1 decimal
}

// Función para calcular la distancia Haversine entre dos puntos
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radio de la Tierra en kilómetros
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return degrees * Math.PI / 180;
}

// Función para generar un tiempo aproximado basado en la cantidad de puntos
function approximateTimeFromPoints(points: number): string {
  // Asumimos que cada punto representa aproximadamente 30 segundos de viaje
  const totalMinutes = Math.max(10, Math.round(points * 0.5));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }
  return `${minutes}min`;
}

// Función para generar una frecuencia aleatoria de servicio
function getRandomFrequency(): string {
  const frequencies = [
    '15-20 min', '20-30 min', '30-40 min', '10-15 min', '20-25 min'
  ];
  return frequencies[Math.floor(Math.random() * frequencies.length)];
}

// Función para encontrar archivos por extensión
function findFiles(dir: string, extension: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  
  const files = fs.readdirSync(dir);
  return files
    .filter(file => file.endsWith(extension))
    .map(file => path.join(dir, file));
}

// Función principal
async function main() {
  if (process.argv.length < 3) {
    console.error('Uso: npx tsx scripts/import-route-without-stops.ts <numero_ruta>');
    process.exit(1);
  }
  
  const routeId = parseInt(process.argv[2], 10);
  if (isNaN(routeId)) {
    console.error('El número de ruta debe ser un número válido');
    process.exit(1);
  }
  
  await importRouteWithoutStops(routeId);
  console.log('Importación completada.');
}

main().catch(console.error);