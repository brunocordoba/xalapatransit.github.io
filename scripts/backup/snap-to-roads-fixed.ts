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
  try {
    // Validar que las coordenadas estén en el formato correcto
    const validCoordinates = coordinates.filter(coord => {
      // Asegurarse de que ambas coordenadas son números válidos
      if (typeof coord[0] !== 'number' || typeof coord[1] !== 'number') {
        return false;
      }
      // Validar que las coordenadas están en rangos lógicos para longitud/latitud
      // Longitud: -180 a 180, Latitud: -90 a 90
      return (coord[0] >= -180 && coord[0] <= 180 && coord[1] >= -90 && coord[1] <= 90);
    });
    
    if (validCoordinates.length < 2) {
      console.warn('No hay suficientes coordenadas válidas para realizar el mapeo.');
      return coordinates;
    }
    
    // Formatear coordenadas para la API de Mapbox (longitud,latitud)
    // Las coordenadas ya deberían estar en formato [longitud, latitud]
    const formattedCoords = validCoordinates
      .map(coord => `${coord[0]},${coord[1]}`)
      .join(';');
    
    // Configuraciones de la API
    const radius = 25; // Radio en metros para buscar calles cercanas 
    const overview = 'full'; // Obtener todos los puntos
    const geometriesFormat = 'geojson'; // Formato de respuesta preferido
    
    // Construir URL para la API de Map Matching
    const url = `https://api.mapbox.com/matching/v5/mapbox/driving/${formattedCoords}?geometries=${geometriesFormat}&radiuses=${Array(validCoordinates.length).fill(radius).join(';')}&steps=false&overview=${overview}&access_token=${MAPBOX_ACCESS_TOKEN}`;
    
    console.log(`Enviando solicitud a Mapbox con ${validCoordinates.length} puntos...`);
    
    const response = await fetch(url);
    
    // Verificar si la respuesta fue exitosa
    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Error en la respuesta de la API (${response.status}): ${errorText}`);
      return coordinates;
    }
    
    const data = await response.json() as MapboxResponse;
    
    if (data.code !== 'Ok' || !data.matchings || data.matchings.length === 0) {
      console.warn('La API de mapeo no pudo hacer match:', data.code);
      return coordinates;
    }
    
    // Extraer las coordenadas ajustadas de la respuesta
    const matchedCoordinates = data.matchings[0].geometry.coordinates;
    
    console.log(`Recibidas ${matchedCoordinates.length} coordenadas ajustadas a calles`);
    
    // Las coordenadas de la respuesta ya están en formato [longitud, latitud]
    return matchedCoordinates as [number, number][];
  } catch (error) {
    console.error('Error en la solicitud de mapeo:', error);
    console.error('Devolviendo coordenadas originales sin ajustar');
    return coordinates;
  }
}

// Función para procesar una ruta individual
async function snapRouteToRoads(route: any): Promise<boolean> {
  try {
    if (!route.geoJSON) {
      console.warn(`La ruta ${route.id} no tiene datos GeoJSON, omitiendo...`);
      return false;
    }
    
    // Convertir de string a objeto si es necesario
    const geoJSON = typeof route.geoJSON === 'string' 
      ? JSON.parse(route.geoJSON) 
      : route.geoJSON;
    
    if (!geoJSON || !geoJSON.geometry || !geoJSON.geometry.coordinates) {
      console.warn(`La ruta ${route.id} tiene un formato GeoJSON inválido, omitiendo...`);
      return false;
    }
    
    console.log(`Procesando ruta ${route.id}: ${route.name}`);
    const originalPointCount = geoJSON.geometry.coordinates.length;
    console.log(`La ruta tiene ${originalPointCount} puntos originales`);
    
    // Ajustar las coordenadas a las calles
    const snappedCoordinates = await snapToRoads(geoJSON.geometry.coordinates);
    console.log(`La ruta ahora tiene ${snappedCoordinates.length} puntos ajustados a calles`);
    
    // Actualizar el GeoJSON con las nuevas coordenadas
    geoJSON.geometry.coordinates = snappedCoordinates;
    
    // Añadir metadatos sobre el proceso
    const metadata = route.metadata ? 
      (typeof route.metadata === 'string' ? JSON.parse(route.metadata) : route.metadata) : 
      {};
    
    // Guardar información sobre el ajuste
    metadata.originalPointCount = originalPointCount;
    metadata.snappedPointCount = snappedCoordinates.length;
    metadata.snappedToRoads = true;
    metadata.snappedAt = new Date().toISOString();
    
    // Guardar los cambios en la base de datos
    await db.update(busRoutes)
      .set({ 
        geoJSON: geoJSON,
        metadata: metadata
      })
      .where(eq(busRoutes.id, route.id));
    
    console.log(`Ruta ${route.id} actualizada correctamente`);
    
    // Guardar un registro de progreso en un archivo
    try {
      const fs = require('fs');
      fs.appendFileSync('snap-to-roads-progress.log', 
        `${new Date().toISOString()} - Procesada ruta ${route.id}: ${route.name} - ${originalPointCount} puntos originales, ${snappedCoordinates.length} puntos ajustados\n`
      );
    } catch (logError) {
      console.warn('Error al guardar progreso en el log:', logError);
    }
    
    return true;
  } catch (error) {
    console.error(`Error al procesar la ruta ${route.id}:`, error);
    return false;
  }
}

// Función para procesar rutas en lotes
async function processBatch(routes: any[], startIndex: number, batchSize: number, delay: number = 1000): Promise<{success: number, error: number}> {
  let successCount = 0;
  let errorCount = 0;
  
  const endIndex = Math.min(startIndex + batchSize, routes.length);
  console.log(`Procesando lote de rutas ${startIndex + 1} a ${endIndex} de ${routes.length}...`);
  
  for (let i = startIndex; i < endIndex; i++) {
    const route = routes[i];
    const success = await snapRouteToRoads(route);
    
    if (success) {
      successCount++;
    } else {
      errorCount++;
    }
    
    // Añadir un pequeño retraso entre peticiones para evitar saturación de la API
    if (i < endIndex - 1) {
      console.log(`Esperando ${delay}ms antes de la siguiente petición...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return { success: successCount, error: errorCount };
}

// Función principal para procesar todas las rutas por lotes
async function snapAllRoutes(batchSize: number = 10, delay: number = 1000) {
  try {
    // Obtener todas las rutas de la base de datos
    const routes = await db.select().from(busRoutes);
    console.log(`Procesando ${routes.length} rutas para ajustarlas a las calles en lotes de ${batchSize}...`);
    
    // Procesar por lotes para evitar saturar la API y la memoria
    let totalSuccess = 0;
    let totalError = 0;
    
    for (let i = 0; i < routes.length; i += batchSize) {
      const results = await processBatch(routes, i, batchSize, delay);
      totalSuccess += results.success;
      totalError += results.error;
      
      console.log(`Progreso: ${i + batchSize >= routes.length ? routes.length : i + batchSize}/${routes.length} rutas procesadas`);
      console.log(`Resultados parciales: ${results.success} exitosas, ${results.error} con errores`);
      
      // Esperar un poco más entre lotes para dar respiro a la API y al sistema
      const batchDelay = 5000; // 5 segundos
      if (i + batchSize < routes.length) {
        console.log(`Esperando ${batchDelay/1000} segundos antes del siguiente lote...`);
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }
    
    console.log(`Proceso de ajuste de rutas completado:`);
    console.log(`Total: ${totalSuccess} rutas ajustadas con éxito, ${totalError} rutas con errores`);
  } catch (error) {
    console.error('Error al procesar las rutas:', error);
  }
}

// Función para procesar un rango específico de rutas (opcional para pruebas o recuperación)
async function snapRouteRange(startId: number, endId: number) {
  try {
    // Obtener todas las rutas primero
    const allRoutes = await db.select().from(busRoutes);
    
    // Filtrar por ID manualmente
    const filteredRoutes = allRoutes.filter(route => 
      route.id >= startId && route.id <= endId
    );
    
    console.log(`Procesando rutas en el rango ${startId}-${endId}...`);
    console.log(`Se encontraron ${filteredRoutes.length} rutas en el rango especificado`);
    
    for (const route of filteredRoutes) {
      await snapRouteToRoads(route);
      // Pequeño retraso entre rutas
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`Procesamiento del rango ${startId}-${endId} completado`);
  } catch (error) {
    console.error(`Error al procesar el rango ${startId}-${endId}:`, error);
  }
}

// Ejecutar la función principal (con parámetros opcionales)
async function main() {
  try {
    // Obtener argumentos de línea de comandos
    const args = process.argv.slice(2);
    
    // Si se especifica un rango, procesar solo ese rango
    if (args.includes('--range')) {
      const rangeIndex = args.indexOf('--range');
      if (args.length >= rangeIndex + 3) {
        const startId = parseInt(args[rangeIndex + 1]);
        const endId = parseInt(args[rangeIndex + 2]);
        
        if (!isNaN(startId) && !isNaN(endId)) {
          await snapRouteRange(startId, endId);
        } else {
          console.error('Los IDs de rango deben ser números');
        }
      } else {
        console.error('Uso correcto: --range startId endId');
      }
    } 
    // Si se especifica un batch size, usarlo
    else if (args.includes('--batch-size')) {
      const batchIndex = args.indexOf('--batch-size');
      if (args.length >= batchIndex + 2) {
        const batchSize = parseInt(args[batchIndex + 1]);
        
        if (!isNaN(batchSize)) {
          await snapAllRoutes(batchSize);
        } else {
          console.error('El tamaño del lote debe ser un número');
        }
      } else {
        console.error('Uso correcto: --batch-size n');
      }
    }
    // De lo contrario, procesar todas las rutas con valores predeterminados
    else {
      await snapAllRoutes();
    }
    
    console.log('Proceso completado con éxito');
    process.exit(0);
  } catch (error) {
    console.error('Error fatal:', error);
    process.exit(1);
  }
}

main();