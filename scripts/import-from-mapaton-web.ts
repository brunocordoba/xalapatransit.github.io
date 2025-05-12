import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { db } from '../server/db';
import { busRoutes, busStops, insertBusRouteSchema, insertBusStopSchema } from '../shared/schema';
import { eq } from 'drizzle-orm';

const MAPATON_BASE_URL = 'https://mapaton.org';

interface CircuitoInfo {
  id: number;
  nombre: string;
  folder: string;
  tipo: 'circuito' | 'ruta' | 'ida' | 'vuelta';
}

/**
 * Obtiene la lista de circuitos desde el sitio web de Mapaton
 */
async function getCircuitosList(): Promise<CircuitoInfo[]> {
  try {
    // Como no podemos obtener la lista directamente, vamos a definir manualmente los circuitos
    // basados en el análisis del código del sitio web
    const circuitos: CircuitoInfo[] = [];
    
    // Rutas directas (circuitos o rutas)
    for (let i = 1; i <= 30; i++) {
      // Verificar si existe como circuito o como ruta
      const folderBase = `${i}_circuito`;
      const tipo = 'circuito';
      
      circuitos.push({
        id: i,
        nombre: `Circuito ${i}`,
        folder: folderBase,
        tipo: tipo
      });
    }
    
    // Rutas con ida y vuelta
    for (const circuito of circuitos) {
      // Clonar como ida y vuelta si es un circuito
      if (circuito.tipo === 'circuito') {
        circuitos.push({
          id: circuito.id,
          nombre: `${circuito.nombre} (Ida)`,
          folder: circuito.folder,
          tipo: 'ida'
        });
        
        circuitos.push({
          id: circuito.id,
          nombre: `${circuito.nombre} (Vuelta)`,
          folder: circuito.folder,
          tipo: 'vuelta'
        });
      }
    }
    
    return circuitos;
  } catch (error) {
    console.error('Error al obtener la lista de circuitos:', error);
    return [];
  }
}

/**
 * Intenta descargar un archivo GeoJSON de ruta desde el sitio web de Mapaton
 */
async function getRouteGeoJson(circuito: CircuitoInfo): Promise<any | null> {
  try {
    const subFolderRoute = circuito.tipo === 'circuito' || circuito.tipo === 'ruta' 
      ? 'route' 
      : `${circuito.tipo}/route`;
    
    const url = `${MAPATON_BASE_URL}/rutas/data/${circuito.folder}/${subFolderRoute}/route.json`;
    console.log(`Intentando descargar ruta de: ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`No se pudo obtener el GeoJSON de la ruta. Código ${response.status}`);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error al obtener el GeoJSON de la ruta para ${circuito.nombre}:`, error);
    return null;
  }
}

/**
 * Intenta descargar un archivo GeoJSON de paradas desde el sitio web de Mapaton
 */
async function getStopsGeoJson(circuito: CircuitoInfo): Promise<any | null> {
  try {
    const subFolderStops = circuito.tipo === 'circuito' || circuito.tipo === 'ruta' 
      ? 'stops' 
      : `${circuito.tipo}/stops`;
    
    const url = `${MAPATON_BASE_URL}/rutas/data/${circuito.folder}/${subFolderStops}/route_${circuito.id}_stops.geojson`;
    console.log(`Intentando descargar paradas de: ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`No se pudo obtener el GeoJSON de las paradas. Código ${response.status}`);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error al obtener el GeoJSON de las paradas para ${circuito.nombre}:`, error);
    return null;
  }
}

/**
 * Función principal para importar rutas y paradas desde el sitio web de Mapaton
 */
async function importFromMapatonWeb() {
  try {
    console.log('Iniciando importación de datos desde el sitio web de Mapaton...');
    
    // Obtener la lista de circuitos
    const circuitos = await getCircuitosList();
    console.log(`Se encontraron ${circuitos.length} posibles circuitos para importar`);
    
    let rutasImportadas = 0;
    let paradasImportadas = 0;
    
    // Procesar cada circuito
    for (const circuito of circuitos) {
      console.log(`\nProcesando ${circuito.nombre} (${circuito.tipo})...`);
      
      // Descargar datos de la ruta
      const routeGeoJson = await getRouteGeoJson(circuito);
      if (!routeGeoJson) {
        console.log(`No se pudo obtener datos para ${circuito.nombre}, omitiendo...`);
        continue;
      }
      
      // Preparar datos de la ruta
      const routeFeature = routeGeoJson.features[0];
      const routeProperties = routeFeature.properties;
      const routeCoordinates = routeFeature.geometry.coordinates;

      // Determinar el nombre de la ruta
      let routeName = `${circuito.id}. Ruta ${circuito.id}`;
      if (circuito.tipo === 'ida') {
        routeName += ' (Ida)';
      } else if (circuito.tipo === 'vuelta') {
        routeName += ' (Vuelta)';
      }
      
      // Determinar zona basada en el ID
      let zone = 'Norte';
      if (circuito.id % 3 === 0) {
        zone = 'Sur';
      } else if (circuito.id % 3 === 1) {
        zone = 'Centro';
      } else {
        zone = 'Norte';
      }
      
      // Verificar si la ruta ya existe
      const existingRoutes = await db.select().from(busRoutes).where(
        eq(busRoutes.name, routeName)
      );

      let routeId: number;
      
      if (existingRoutes.length > 0) {
        // La ruta ya existe, usar el ID existente
        routeId = existingRoutes[0].id;
        console.log(`La ruta "${routeName}" ya existe con ID ${routeId}, actualizando...`);
        
        // Actualizar la ruta con los nuevos datos
        await db.update(busRoutes)
          .set({
            coordinates: routeCoordinates as any,
            color: routeProperties.color || '#33c775'
          })
          .where(eq(busRoutes.id, routeId));
      } else {
        // Insertar nueva ruta
        console.log(`Insertando nueva ruta: ${routeName}`);
        
        const newRoute = insertBusRouteSchema.parse({
          name: routeName,
          shortName: `R${circuito.id}`,
          description: `Ruta de transporte público de Xalapa, número ${circuito.id}`,
          zone: zone,
          approximateTime: '30-40 min',
          frequency: '15-20 min',
          coordinates: routeCoordinates,
          snappedCoordinates: routeCoordinates, // Usamos las mismas coordenadas como snapped por ahora
          color: routeProperties.color || '#33c775' // Color por defecto de Mapaton
        });
        
        const insertResult = await db.insert(busRoutes).values(newRoute).returning();
        routeId = insertResult[0].id;
        rutasImportadas++;
      }
      
      // Descargar datos de las paradas
      const stopsGeoJson = await getStopsGeoJson(circuito);
      if (!stopsGeoJson) {
        console.log(`No se pudieron obtener paradas para ${circuito.nombre}, omitiendo...`);
        continue;
      }
      
      // Verificar si ya existen paradas para esta ruta
      const existingStops = await db.select().from(busStops).where(
        eq(busStops.routeId, routeId)
      );
      
      if (existingStops.length > 0) {
        console.log(`La ruta ${routeId} ya tiene ${existingStops.length} paradas, omitiendo importación de paradas...`);
        continue;
      }
      
      // Insertar paradas
      console.log(`Insertando paradas para la ruta ${routeId}...`);
      
      let stopCount = 0;
      for (const stopFeature of stopsGeoJson.features) {
        const coordinates = stopFeature.geometry.coordinates;
        
        const stopName = stopFeature.properties.name || `Parada ${stopCount + 1}`;
        const isTerminal = stopCount === 0 || stopCount === stopsGeoJson.features.length - 1;
        const terminalType = isTerminal 
          ? (stopCount === 0 ? 'origen' : 'destino')
          : '';
        
        const newStop = insertBusStopSchema.parse({
          routeId: routeId,
          name: stopName,
          coordinates: coordinates,
          isTerminal: isTerminal,
          terminalType: terminalType
        });
        
        await db.insert(busStops).values(newStop);
        stopCount++;
        
        if (stopCount % 10 === 0) {
          console.log(`Insertadas ${stopCount} paradas...`);
        }
      }
      
      console.log(`Se insertaron ${stopCount} paradas para la ruta ${routeId}`);
      paradasImportadas += stopCount;
    }
    
    console.log(`\nImportación finalizada. Se importaron ${rutasImportadas} rutas y ${paradasImportadas} paradas.`);
  } catch (error) {
    console.error('Error durante la importación:', error);
  }
}

// Ejecutar la función principal
importFromMapatonWeb().then(() => {
  console.log('Proceso completado.');
  process.exit(0);
}).catch(error => {
  console.error('Error en el proceso principal:', error);
  process.exit(1);
});