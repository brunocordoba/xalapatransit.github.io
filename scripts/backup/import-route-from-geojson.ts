import * as fs from 'fs';
import * as path from 'path';
import { db } from '../server/db';
import { busRoutes as routes, insertBusRouteSchema } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Función principal para importar una ruta desde un archivo GeoJSON
async function importRouteFromGeoJSON(routeId: number, geojsonPath: string) {
  console.log(`Importando ruta ${routeId} desde: ${geojsonPath}`);
  
  try {
    if (!fs.existsSync(geojsonPath)) {
      console.error(`El archivo ${geojsonPath} no existe.`);
      return;
    }
    
    // Leer el archivo GeoJSON
    const geojsonStr = fs.readFileSync(geojsonPath, 'utf8');
    const geojson = JSON.parse(geojsonStr);
    
    // Verificar si el GeoJSON tiene la estructura esperada
    if (!geojson || !geojson.features || !geojson.features.length) {
      console.error('El archivo GeoJSON no tiene la estructura esperada.');
      return;
    }
    
    // Extraer las coordenadas
    const feature = geojson.features[0]; // Tomamos la primera feature
    
    // Si es un LineString
    if (feature.geometry.type === 'LineString') {
      const coordinates = feature.geometry.coordinates;
      await createRoute(routeId, coordinates);
    } 
    // Si es un MultiLineString (tomar la primera línea)
    else if (feature.geometry.type === 'MultiLineString') {
      const coordinates = feature.geometry.coordinates[0]; // Primera línea
      await createRoute(routeId, coordinates);
    } else {
      console.error(`Tipo de geometría no soportado: ${feature.geometry.type}`);
    }
    
  } catch (error) {
    console.error(`Error importando desde GeoJSON ${geojsonPath}:`, error);
  }
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
    stopsCount: 0, // Sin paradas
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
  
  // Verificar si la ruta ya existe
  const existingRoutes = await db.select()
    .from(routes)
    .where(eq(routes.name, `Ruta ${routeId}`));
  
  if (existingRoutes.length > 0) {
    console.log(`La Ruta ${routeId} ya existe. ID: ${existingRoutes[0].id}`);
    return existingRoutes[0];
  }
  
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
    console.error('Uso: npx tsx scripts/import-route-from-geojson.ts <id_ruta> <ruta_archivo_geojson>');
    process.exit(1);
  }
  
  const routeId = parseInt(process.argv[2], 10);
  const geojsonPath = process.argv[3];
  
  if (isNaN(routeId)) {
    console.error('El ID de ruta debe ser un número válido');
    process.exit(1);
  }
  
  if (!fs.existsSync(geojsonPath)) {
    console.error(`El archivo GeoJSON ${geojsonPath} no existe`);
    process.exit(1);
  }
  
  await importRouteFromGeoJSON(routeId, geojsonPath);
  console.log('Importación completada.');
}

main().catch(console.error);