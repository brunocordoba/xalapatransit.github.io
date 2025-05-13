import * as fs from 'fs';
import * as path from 'path';
import { db } from '../server/db';
import { busRoutes as routes, busStops as stops, insertBusRouteSchema } from '../shared/schema';
import { parseStringPromise } from 'xml2js';

// Función principal para importar ruta desde archivo KML
async function importRouteFromKML(routeId: number, kmlPath: string) {
  console.log(`Importando ruta ${routeId} desde archivo KML: ${kmlPath}`);
  
  try {
    // Leer el archivo KML
    const kmlContent = fs.readFileSync(kmlPath, 'utf8');
    
    // Extraer coordenadas del KML
    const coordinates = await extractCoordinatesFromKML(kmlContent);
    if (!coordinates || coordinates.length === 0) {
      console.error('No se pudo extraer coordenadas del archivo KML');
      return;
    }
    
    console.log(`Se extrajeron ${coordinates.length} coordenadas del archivo KML`);
    
    // Crear la ruta en la base de datos
    const routeRecord = await createRoute(routeId, coordinates);
    console.log(`✅ Ruta ${routeId} importada con éxito. ID: ${routeRecord.id} - ${coordinates.length} puntos`);
    
  } catch (error) {
    console.error(`Error importando ruta desde KML:`, error);
  }
}

// Función para extraer coordenadas de un archivo KML usando xml2js
async function extractCoordinatesFromKML(kmlContent: string): Promise<[number, number][]> {
  try {
    const result = await parseStringPromise(kmlContent, { explicitArray: false });
    
    if (!result.kml || !result.kml.Document || !result.kml.Document.Placemark) {
      console.error('El archivo KML no tiene la estructura esperada');
      return [];
    }
    
    const placemark = result.kml.Document.Placemark;
    
    if (!placemark.LineString || !placemark.LineString.coordinates) {
      console.error('No se encontraron coordenadas en el KML');
      return [];
    }
    
    const coordinatesStr = placemark.LineString.coordinates;
    return parseCoordinatesString(coordinatesStr);
    
  } catch (error) {
    console.error('Error al procesar el XML del KML:', error);
    
    // Fallback a regex si falla el parsing XML
    console.log('Intentando extraer coordenadas con regex...');
    const coordsMatch = kmlContent.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
    if (coordsMatch && coordsMatch[1]) {
      return parseCoordinatesString(coordsMatch[1]);
    }
    
    return [];
  }
}

// Función para parsear el string de coordenadas a array de coordenadas
function parseCoordinatesString(coordinatesStr: string): [number, number][] {
  const coordinates: [number, number][] = [];
  
  const coordPairs = coordinatesStr
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  
  for (const pair of coordPairs) {
    const parts = pair.split(',');
    if (parts.length >= 2) {
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      
      if (!isNaN(lng) && !isNaN(lat)) {
        coordinates.push([lng, lat]);
      }
    }
  }
  
  return coordinates;
}

// Función para crear una ruta en la base de datos
async function createRoute(routeId: number, coordinates: [number, number][]) {
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

// Función principal
async function main() {
  if (process.argv.length < 4) {
    console.error('Uso: npx tsx scripts/import-using-kml.ts <numero_ruta> <ruta_archivo_kml>');
    process.exit(1);
  }
  
  const routeId = parseInt(process.argv[2], 10);
  const kmlPath = process.argv[3];
  
  if (isNaN(routeId)) {
    console.error('El número de ruta debe ser un número válido');
    process.exit(1);
  }
  
  if (!fs.existsSync(kmlPath)) {
    console.error(`El archivo KML no existe: ${kmlPath}`);
    process.exit(1);
  }
  
  await importRouteFromKML(routeId, kmlPath);
  console.log('Importación completada.');
}

main().catch(console.error);