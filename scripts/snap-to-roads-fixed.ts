import * as fs from 'fs';
import fetch from 'node-fetch';
import { db } from '../server/db';
import { busRoutes } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Token de acceso de Mapbox desde variables de entorno
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

if (!MAPBOX_ACCESS_TOKEN) {
  console.error('Error: MAPBOX_ACCESS_TOKEN no está definido en las variables de entorno');
  process.exit(1);
}

// Interfaz para la respuesta de Mapbox
interface MapboxResponse {
  code: string;
  matchings?: Array<{
    geometry: {
      coordinates: [number, number][];
    };
  }>;
}

// Función para ajustar una ruta a las calles usando la API de Mapbox Map Matching
async function snapToRoads(coordinates: [number, number][]): Promise<[number, number][]> {
  try {
    // Limitar a 100 coordenadas por petición (limitación de la API de Mapbox)
    const maxCoordinatesPerRequest = 100;
    
    if (coordinates.length <= maxCoordinatesPerRequest) {
      // Caso simple: pocas coordenadas, una sola petición
      return await performSnapRequest(coordinates);
    } else {
      // Caso complejo: muchas coordenadas, dividir en múltiples peticiones
      let result: [number, number][] = [];
      
      // Procesar en lotes con cierto solapamiento para mantener continuidad
      for (let i = 0; i < coordinates.length; i += maxCoordinatesPerRequest - 5) {
        const batch = coordinates.slice(i, i + maxCoordinatesPerRequest);
        
        if (batch.length < 2) {
          // Necesitamos al menos 2 puntos para el mapeo
          break;
        }
        
        const snappedBatch = await performSnapRequest(batch);
        
        // Para el primer lote, añadir todo
        if (i === 0) {
          result = snappedBatch;
        } else {
          // Para los siguientes lotes, descartar los primeros 5 puntos para evitar duplicados
          result = result.concat(snappedBatch.slice(5));
        }
      }
      
      return result;
    }
  } catch (error) {
    console.error('Error al hacer snap de la ruta:', error);
    // En caso de error, devolver las coordenadas originales
    return coordinates;
  }
}

// Función auxiliar para realizar una solicitud de mapeo a Mapbox
async function performSnapRequest(coordinates: [number, number][]): Promise<[number, number][]> {
  // Formatear coordenadas para la API de Mapbox (longitud,latitud)
  const formattedCoords = coordinates
    .map(coord => `${coord[0]},${coord[1]}`)
    .join(';');
  
  // Construir URL para la API de Map Matching
  const url = `https://api.mapbox.com/matching/v5/mapbox/driving/${formattedCoords}?geometries=geojson&radiuses=${Array(coordinates.length).fill(25).join(';')}&steps=false&access_token=${MAPBOX_ACCESS_TOKEN}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json() as MapboxResponse;
    
    if (data.code !== 'Ok' || !data.matchings || data.matchings.length === 0) {
      console.warn('La API de mapeo no pudo hacer match:', data);
      return coordinates;
    }
    
    // Extraer las coordenadas ajustadas de la respuesta
    const matchedCoordinates = data.matchings[0].geometry.coordinates;
    
    // Ya están en el formato que esperamos [longitud, latitud]
    return matchedCoordinates;
  } catch (error) {
    console.error('Error en la solicitud de mapeo:', error);
    return coordinates;
  }
}

// Función principal para procesar todas las rutas
async function snapAllRoutes() {
  try {
    // Obtener todas las rutas de la base de datos
    const routes = await db.select().from(busRoutes);
    console.log(`Procesando ${routes.length} rutas para ajustarlas a las calles...`);
    
    for (const route of routes) {
      if (!route.geoJSON) {
        console.warn(`La ruta ${route.id} no tiene datos GeoJSON, omitiendo...`);
        continue;
      }
      
      // Convertir de string a objeto si es necesario
      const geoJSON = typeof route.geoJSON === 'string' 
        ? JSON.parse(route.geoJSON) 
        : route.geoJSON;
      
      if (!geoJSON || !geoJSON.geometry || !geoJSON.geometry.coordinates) {
        console.warn(`La ruta ${route.id} tiene un formato GeoJSON inválido, omitiendo...`);
        continue;
      }
      
      console.log(`Procesando ruta ${route.id}: ${route.name}`);
      console.log(`La ruta tiene ${geoJSON.geometry.coordinates.length} puntos originales`);
      
      // Ajustar las coordenadas a las calles
      const snappedCoordinates = await snapToRoads(geoJSON.geometry.coordinates);
      console.log(`La ruta ahora tiene ${snappedCoordinates.length} puntos ajustados a calles`);
      
      // Actualizar el GeoJSON con las nuevas coordenadas
      geoJSON.geometry.coordinates = snappedCoordinates;
      
      // Guardar los cambios en la base de datos
      await db.update(busRoutes)
        .set({ geoJSON: geoJSON })
        .where(eq(busRoutes.id, route.id));
      
      console.log(`Ruta ${route.id} actualizada correctamente`);
    }
    
    console.log('Proceso de ajuste de rutas completado');
  } catch (error) {
    console.error('Error al procesar las rutas:', error);
  }
}

// Ejecutar la función principal
async function main() {
  try {
    await snapAllRoutes();
    console.log('Proceso completado con éxito');
    process.exit(0);
  } catch (error) {
    console.error('Error fatal:', error);
    process.exit(1);
  }
}

main();