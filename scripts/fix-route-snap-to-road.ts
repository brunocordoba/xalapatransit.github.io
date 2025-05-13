import { drizzle } from 'drizzle-orm/neon-serverless';
import { eq } from 'drizzle-orm';
import { Pool } from '@neondatabase/serverless';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

// Importar schema
import { busRoutes, busStops } from '../shared/schema';

// Configurar conexión a la base de datos
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema: { busRoutes, busStops } });

// Asegurarse de que el token de Mapbox está disponible
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
if (!MAPBOX_ACCESS_TOKEN) {
  throw new Error('MAPBOX_ACCESS_TOKEN environment variable is not set');
}

// Función para dividir un array de coordenadas en chunks más pequeños
// Mapbox tiene un límite de 100 puntos por solicitud
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// Función para ajustar coordenadas a carreteras usando Mapbox API
async function snapToRoad(coordinates: [number, number][]): Promise<[number, number][]> {
  if (coordinates.length <= 1) {
    return coordinates;
  }

  // Si hay demasiados puntos, dividir en chunks
  if (coordinates.length > 90) {
    const chunks = chunkArray(coordinates, 90);
    const snappedChunks: [number, number][][] = [];

    for (const chunk of chunks) {
      const snappedChunk = await snapToRoad(chunk as [number, number][]);
      snappedChunks.push(snappedChunk);
    }

    // Unir todos los chunks
    return snappedChunks.flat();
  }

  // Formato de coordenadas para la API de Mapbox: lon,lat
  const coordinatesStr = coordinates
    .map(coord => `${coord[0]},${coord[1]}`)
    .join(';');

  try {
    // Construir la URL con los parámetros adecuados
    const url = `https://api.mapbox.com/matching/v5/mapbox/driving/${coordinatesStr}?access_token=${MAPBOX_ACCESS_TOKEN}&geometries=geojson&overview=full&radiuses=${Array(coordinates.length).fill(25).join(';')}`;

    // Hacer la solicitud a la API
    const response = await fetch(url);
    const data = await response.json() as any;

    // Verificar que la respuesta sea válida
    if (data.code !== 'Ok' || !data.matchings || data.matchings.length === 0) {
      console.error('Error en Mapbox API:', data);
      return coordinates; // Devolver coordenadas originales si hay error
    }

    // Extraer las coordenadas ajustadas
    return data.matchings[0].geometry.coordinates as [number, number][];
  } catch (error) {
    console.error('Error al hacer la solicitud a Mapbox:', error);
    return coordinates; // Devolver coordenadas originales si hay error
  }
}

// Función para procesar una ruta específica
async function processRoute(routeId: number) {
  try {
    // Obtener la ruta de la base de datos
    const [route] = await db.select().from(busRoutes).where(eq(busRoutes.id, routeId));
    
    if (!route) {
      console.error(`Ruta con ID ${routeId} no encontrada`);
      return false;
    }

    // Parsear el geoJSON para obtener las coordenadas
    const geoJSON = route.geoJSON ? JSON.parse(route.geoJSON as string) : null;
    if (!geoJSON || !geoJSON.coordinates || !Array.isArray(geoJSON.coordinates)) {
      console.error(`Formato inválido de geoJSON para la ruta ${routeId}`);
      return false;
    }

    const coordinates = geoJSON.coordinates as [number, number][];
    console.log(`Procesando ruta ${routeId} (${route.name}) con ${coordinates.length} puntos`);

    // Crear carpeta de respaldo si no existe
    const backupDir = path.join(__dirname, '../data/backup');
    await fs.mkdir(backupDir, { recursive: true });

    // Guardar copia de seguridad
    await fs.writeFile(
      path.join(backupDir, `route_${routeId}_backup.json`),
      JSON.stringify(geoJSON, null, 2)
    );

    // Ajustar coordenadas a carreteras
    console.log(`Aplicando Snap to Road a ruta ${routeId}...`);
    const snappedCoordinates = await snapToRoad(coordinates);
    console.log(`Ruta ${routeId} ajustada. Puntos originales: ${coordinates.length}, Puntos ajustados: ${snappedCoordinates.length}`);

    // Actualizar el geoJSON
    const updatedGeoJSON = {
      ...geoJSON,
      coordinates: snappedCoordinates
    };

    // Actualizar la ruta en la base de datos
    await db.update(busRoutes)
      .set({ 
        geoJSON: JSON.stringify(updatedGeoJSON),
        updatedAt: new Date()
      })
      .where(eq(busRoutes.id, routeId));

    console.log(`Ruta ${routeId} actualizada con éxito`);
    return true;
  } catch (error) {
    console.error('Error al procesar la ruta:', error);
    return false;
  }
}

// Función principal
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Por favor especifica un ID de ruta. Ejemplo: npm run snap-route 123');
    process.exit(1);
  }

  const routeId = parseInt(args[0], 10);
  if (isNaN(routeId)) {
    console.error('El ID de ruta debe ser un número');
    process.exit(1);
  }

  try {
    await processRoute(routeId);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

// Ejecutar script
main();