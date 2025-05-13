import * as fs from 'fs';
import * as path from 'path';
import { db } from '../server/db';
import { busRoutes as routes, busStops as stops, insertBusRouteSchema } from '../shared/schema';

// Función principal para importar ruta desde archivo GeoJSON
async function importRouteFromGeoJSON(routeId: number, geojsonPath: string) {
  console.log(`Importando ruta ${routeId} desde archivo GeoJSON: ${geojsonPath}`);
  
  try {
    // Leer el archivo GeoJSON
    const geojsonContent = fs.readFileSync(geojsonPath, 'utf8');
    
    // Parsear el GeoJSON
    const geojson = JSON.parse(geojsonContent);
    
    if (!geojson.features || !geojson.features.length) {
      console.error('El archivo GeoJSON no tiene features');
      return;
    }
    
    // Extraer la primera feature (la ruta)
    const feature = geojson.features[0];
    
    if (feature.type !== 'Feature' || 
        !feature.geometry || 
        feature.geometry.type !== 'LineString' || 
        !feature.geometry.coordinates ||
        !feature.geometry.coordinates.length) {
      console.error('El GeoJSON no contiene una geometría LineString válida');
      return;
    }
    
    // Extraer coordenadas
    const coordinates = feature.geometry.coordinates as [number, number][];
    console.log(`Se extrajeron ${coordinates.length} coordenadas del GeoJSON`);
    
    // Extraer propiedades
    let routeName = `Ruta ${routeId}`;
    let routeDesc = '';
    
    if (feature.properties) {
      if (feature.properties.name) {
        routeName = feature.properties.name;
      }
      
      if (feature.properties.desc) {
        routeDesc = feature.properties.desc;
      }
    }
    
    // Crear la ruta en la base de datos
    const routeRecord = await createRoute(routeId, coordinates, routeName, routeDesc);
    console.log(`✅ Ruta ${routeId} importada con éxito. ID: ${routeRecord.id} - ${coordinates.length} puntos`);
    
  } catch (error) {
    console.error(`Error importando ruta desde GeoJSON:`, error);
  }
}

// Función para crear una ruta en la base de datos
async function createRoute(
  routeId: number, 
  coordinates: [number, number][],
  routeName: string = `Ruta ${routeId}`,
  routeDesc: string = ''
) {
  // Determinar la zona basado en el ID de la ruta
  const zone = determineZone(routeId);
  
  // Generar nombre corto
  const shortName = `R${routeId}`;
  
  // Datos para la inserción de la ruta
  const routeData = {
    name: routeName,
    shortName: shortName,
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
        name: routeName,
        shortName: shortName,
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
    console.error('Uso: npx tsx scripts/import-from-geojson.ts <numero_ruta> <ruta_archivo_geojson>');
    process.exit(1);
  }
  
  const routeId = parseInt(process.argv[2], 10);
  const geojsonPath = process.argv[3];
  
  if (isNaN(routeId)) {
    console.error('El número de ruta debe ser un número válido');
    process.exit(1);
  }
  
  if (!fs.existsSync(geojsonPath)) {
    console.error(`El archivo GeoJSON no existe: ${geojsonPath}`);
    process.exit(1);
  }
  
  await importRouteFromGeoJSON(routeId, geojsonPath);
  console.log('Importación completada.');
}

main().catch(console.error);