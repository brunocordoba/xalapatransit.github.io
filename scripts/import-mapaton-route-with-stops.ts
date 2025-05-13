import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../server/db';
import { busRoutes, busStops, insertBusRouteSchema, insertBusStopSchema } from '../shared/schema';
import { eq } from 'drizzle-orm';

// ESM compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Función principal para importar ruta y paradas de los archivos GeoJSON
async function importMapatonRouteWithStops(routeId: number, routeJsonPath: string, stopsJsonPath: string) {
  console.log(`Importando ruta ${routeId} desde: ${routeJsonPath}`);
  console.log(`Importando paradas de la ruta ${routeId} desde: ${stopsJsonPath}`);
  
  try {
    // Verificar que los archivos existen
    if (!fs.existsSync(routeJsonPath)) {
      console.error(`El archivo de ruta ${routeJsonPath} no existe.`);
      return;
    }
    
    if (!fs.existsSync(stopsJsonPath)) {
      console.error(`El archivo de paradas ${stopsJsonPath} no existe.`);
      return;
    }
    
    // Leer los archivos JSON
    const routeData = JSON.parse(fs.readFileSync(routeJsonPath, 'utf8'));
    const stopsData = JSON.parse(fs.readFileSync(stopsJsonPath, 'utf8'));
    
    // Verificar que el formato es correcto (GeoJSON)
    if (!routeData.type || !routeData.features || !Array.isArray(routeData.features)) {
      console.error('El archivo de ruta no está en formato GeoJSON válido.');
      return;
    }
    
    if (!stopsData.type || !stopsData.features || !Array.isArray(stopsData.features)) {
      console.error('El archivo de paradas no está en formato GeoJSON válido.');
      return;
    }
    
    // Extraer la ruta
    const routeFeature = routeData.features[0];
    if (!routeFeature || !routeFeature.geometry || routeFeature.geometry.type !== "LineString") {
      console.error('No se encontró una línea válida en el archivo de ruta.');
      return;
    }
    
    // Extraer las coordenadas de la ruta
    const coordinates = routeFeature.geometry.coordinates;
    
    // Extraer propiedades de la ruta
    const routeProps = routeFeature.properties || {};
    const name = `Ruta ${routeId}`;
    const shortName = `R${routeId}`;
    const description = routeProps.desc || '';
    
    // Determinar zona basado en el ID o la descripción
    const zone = determineZone(routeId, description);
    
    // Crear ruta en la base de datos
    const routeDbId = await createRoute(routeId, name, shortName, zone, description, coordinates);
    if (!routeDbId) {
      console.error('Error al crear la ruta en la base de datos.');
      return;
    }
    
    // Extraer y crear las paradas
    const stopsImported = await createStops(routeDbId, stopsData.features);
    
    console.log(`✅ Ruta ${routeId} importada con éxito. ID: ${routeDbId}`);
    console.log(`✅ ${stopsImported} paradas importadas para la ruta ${routeId}`);
    
  } catch (error) {
    console.error(`Error en la importación:`, error);
  }
}

// Función para crear una ruta en la base de datos
async function createRoute(
  routeId: number, 
  name: string, 
  shortName: string, 
  zone: string, 
  description: string, 
  coordinates: [number, number][]
): Promise<number | null> {
  try {
    // Verificar si la ruta ya existe
    const existingRoutes = await db.select()
      .from(busRoutes)
      .where(eq(busRoutes.name, name));
    
    if (existingRoutes.length > 0) {
      console.log(`La ruta ${name} ya existe en la base de datos. ID: ${existingRoutes[0].id}`);
      return existingRoutes[0].id;
    }
    
    // Datos para la inserción de la ruta
    const routeData = {
      name,
      shortName,
      description: description || `Ruta de autobús ${routeId} en Xalapa`,
      color: getRandomColor(),
      frequency: getRandomFrequency(),
      scheduleStart: '05:00',
      scheduleEnd: '22:00',
      stopsCount: 0, // Se actualizará después
      approximateTime: approximateTimeFromPoints(coordinates.length),
      zone,
      geoJSON: {
        type: "LineString",
        coordinates
      },
    };
    
    // Validar los datos con el esquema de inserción
    const parsedData = insertBusRouteSchema.parse(routeData);
    
    // Insertar la ruta en la base de datos
    const [insertedRoute] = await db.insert(busRoutes).values(parsedData).returning();
    
    console.log(`✅ Ruta creada: ${name} (ID: ${insertedRoute.id}) con ${coordinates.length} puntos`);
    
    return insertedRoute.id;
  } catch (error) {
    console.error('Error al crear la ruta:', error);
    return null;
  }
}

// Función para crear paradas de autobús en la base de datos
async function createStops(routeId: number, stopsFeatures: any[]): Promise<number> {
  let createdCount = 0;
  
  try {
    // Limpiar paradas existentes para esa ruta si las hay
    await db.delete(busStops).where(eq(busStops.routeId, routeId));
    
    // Ordenar paradas por sequence si existe la propiedad
    const sortedStops = [...stopsFeatures].sort((a, b) => {
      const seqA = a.properties?.sequence || 0;
      const seqB = b.properties?.sequence || 0;
      return seqA - seqB;
    });
    
    // Crear cada parada
    for (let i = 0; i < sortedStops.length; i++) {
      const stop = sortedStops[i];
      
      if (!stop.geometry || stop.geometry.type !== "Point" || !stop.geometry.coordinates) {
        console.warn('Parada sin geometría válida, omitiendo...');
        continue;
      }
      
      const coordinates = stop.geometry.coordinates;
      const props = stop.properties || {};
      
      // Generar un nombre para la parada si no lo tiene
      const stopName = props.name || `Parada ${i + 1} de Ruta ${routeId}`;
      
      // Datos para la inserción de la parada
      const stopData = {
        routeId,
        name: stopName,
        description: props.description || '',
        latitude: coordinates[1],
        longitude: coordinates[0],
        location: {
          type: "Point",
          coordinates: [coordinates[0], coordinates[1]]
        },
        sequence: props.sequence || i,
        waitTime: props.dwellTime || 0,
      };
      
      // Validar los datos con el esquema de inserción
      const parsedData = insertBusStopSchema.parse(stopData);
      
      // Insertar la parada en la base de datos
      const [insertedStop] = await db.insert(busStops).values(parsedData).returning();
      createdCount++;
    }
    
    // Actualizar el conteo de paradas en la ruta
    await db.update(busRoutes)
      .set({ stopsCount: createdCount })
      .where(eq(busRoutes.id, routeId));
    
    return createdCount;
  } catch (error) {
    console.error('Error al crear las paradas:', error);
    return createdCount;
  }
}

// Función para determinar la zona basado en el ID de la ruta y la descripción
function determineZone(routeId: number, description: string): string {
  // Primero intentamos extraer de la descripción
  description = description.toLowerCase();
  
  if (description.includes('norte') || description.includes('santa rosa')) {
    return 'Norte';
  }
  if (description.includes('sur') || description.includes('sumidero')) {
    return 'Sur';
  }
  if (description.includes('este') || description.includes('macuiltepetl')) {
    return 'Este';
  }
  if (description.includes('oeste') || description.includes('animas')) {
    return 'Oeste';
  }
  if (description.includes('centro') || description.includes('xalapa')) {
    return 'Centro';
  }
  
  // Fallback por ID
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
  if (process.argv.length < 5) {
    console.error('Uso: tsx scripts/import-mapaton-route-with-stops.ts <id_ruta> <ruta_archivo_ruta.json> <ruta_archivo_paradas.json>');
    process.exit(1);
  }
  
  const routeId = parseInt(process.argv[2], 10);
  const routeJsonPath = process.argv[3];
  const stopsJsonPath = process.argv[4];
  
  if (isNaN(routeId)) {
    console.error('El ID de ruta debe ser un número válido');
    process.exit(1);
  }
  
  await importMapatonRouteWithStops(routeId, routeJsonPath, stopsJsonPath);
  console.log('Importación completada.');
}

main().catch(console.error);