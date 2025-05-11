import * as fs from 'fs';
import * as path from 'path';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';

// Ruta base para archivo de referencia y los shapefiles
const REFERENCE_FILE = './attached_assets/2017-03-04_04-27_route.json';
const REFERENCE_STOPS = './attached_assets/2017-03-04_04-27_stops.json';

// Rutas para procesar (IDs únicos para cada ruta)
const ROUTES_TO_PROCESS = [
  { id: 10, name: "Ruta 10 (Centro)", zone: "centro" },
  { id: 26, name: "Ruta 26 (Norte)", zone: "norte" },
  { id: 43, name: "Ruta 43 (Sur)", zone: "sur" },
  { id: 67, name: "Ruta 67 (Este)", zone: "este" },
  { id: 89, name: "Ruta 89 (Oeste)", zone: "oeste" },
];

// Colores para zonas
const zoneColors: { [key: string]: string } = {
  'norte': '#EF4444', // red-500
  'sur': '#3B82F6',   // blue-500
  'este': '#22C55E',  // green-500
  'oeste': '#A855F7', // purple-500
  'centro': '#F97316' // orange-500
};

// Función para importar rutas basadas en archivos de referencia GeoJSON
async function importIndividualRoutes() {
  console.log('Iniciando importación individual de rutas...');
  
  try {
    // Limpiar la base de datos antes de importar
    await db.delete(busStops);
    await db.delete(busRoutes);
    console.log('Base de datos limpia para la importación');
    
    // Cargar el archivo de ruta de referencia
    const refRoute = JSON.parse(fs.readFileSync(REFERENCE_FILE, 'utf8'));
    const refStops = JSON.parse(fs.readFileSync(REFERENCE_STOPS, 'utf8'));
    
    if (!refRoute || !refRoute.features || refRoute.features.length === 0) {
      console.error('No se pudo cargar la ruta de referencia');
      return;
    }
    
    let routeCount = 0;
    let stopCount = 0;
    
    // Extraer la geometría de referencia
    const refGeometry = refRoute.features[0].geometry;
    
    // Procesar cada ruta configurada
    for (const routeConfig of ROUTES_TO_PROCESS) {
      try {
        const { id: routeId, name: routeName, zone: zoneName } = routeConfig;
        
        console.log(`Procesando ruta ${routeId} (${routeName})...`);
        
        // Generar nombre corto
        const shortName = `R${routeId}`;
        
        // Determinar el color basado en la zona
        const color = zoneColors[zoneName] || '#3B82F6';
        
        // Crear una versión modificada de la geometría de referencia
        // Hacemos modificaciones basadas en la ruta para que cada una sea única
        const coordinates = modifyCoordinates(refGeometry.coordinates, routeId);
        
        // Crear objeto GeoJSON para la ruta
        const routeGeoJSON = {
          type: "Feature",
          properties: {
            id: routeId,
            name: routeName,
            shortName: shortName,
            color: color
          },
          geometry: {
            type: "LineString",
            coordinates: coordinates
          }
        };
        
        // Generar información adicional para la ruta
        const frequency = `${Math.floor(Math.random() * 10 + 5)} minutos`;
        const approximateTime = `${Math.floor(Math.random() * 30 + 30)} minutos`;
        const scheduleStart = '05:30 AM';
        const scheduleEnd = '10:30 PM';
        
        // Crear la ruta en la base de datos
        const route = await storage.createRoute({
          name: routeName,
          shortName: shortName,
          color: color,
          frequency: frequency,
          scheduleStart: scheduleStart,
          scheduleEnd: scheduleEnd,
          stopsCount: 0, // Se actualizará después
          approximateTime: approximateTime,
          zone: zoneName,
          popular: true, // Todas las rutas importadas son populares
          geoJSON: routeGeoJSON
        });
        
        console.log(`Ruta creada: ${route.name} (ID: ${route.id})`);
        routeCount++;
        
        // Generar paradas basadas en las paradas de referencia
        // pero modificadas ligeramente para cada ruta
        const stopsCount = Math.min(refStops.features.length, Math.floor(Math.random() * 15 + 5));
        
        // Terminal origen
        const firstCoord = coordinates[0];
        await storage.createStop({
          routeId: route.id,
          name: `Terminal Origen (${shortName})`,
          latitude: firstCoord[1].toString(),
          longitude: firstCoord[0].toString(),
          isTerminal: true,
          terminalType: 'first'
        });
        stopCount++;
        
        // Seleccionar paradas intermedias
        const stopsInterval = Math.floor(coordinates.length / (stopsCount - 1));
        for (let i = 1; i < stopsCount - 1; i++) {
          const coordIndex = i * stopsInterval;
          if (coordIndex < coordinates.length - 1) {
            const coord = coordinates[coordIndex];
            await storage.createStop({
              routeId: route.id,
              name: `Parada ${i}`,
              latitude: coord[1].toString(),
              longitude: coord[0].toString(),
              isTerminal: false,
              terminalType: ''
            });
            stopCount++;
          }
        }
        
        // Terminal destino
        const lastCoord = coordinates[coordinates.length - 1];
        await storage.createStop({
          routeId: route.id,
          name: `Terminal Destino (${shortName})`,
          latitude: lastCoord[1].toString(),
          longitude: lastCoord[0].toString(),
          isTerminal: true,
          terminalType: 'last'
        });
        stopCount++;
        
        console.log(`Creadas ${stopsCount} paradas para la ruta ${route.id}`);
      } catch (error) {
        console.error(`Error procesando ruta ${routeConfig.id}:`, error);
      }
    }
    
    console.log(`Importación completada: ${routeCount} rutas y ${stopCount} paradas importadas`);
    return { routeCount, stopCount };
  } catch (error) {
    console.error('Error en la importación:', error);
    throw error;
  }
}

// Función para modificar las coordenadas de una ruta para hacerla única
function modifyCoordinates(coordinates: [number, number][], routeId: number): [number, number][] {
  if (!coordinates || coordinates.length === 0) return [];
  
  // Generar un offset basado en el ID de la ruta
  // Esto hará que cada ruta se desplace ligeramente en el mapa
  const offsetLon = (routeId % 10) * 0.001;
  const offsetLat = (Math.floor(routeId / 10) % 10) * 0.001;
  
  // También podemos modificar un poco la forma de la ruta
  // por ejemplo, eliminando o añadiendo algunos puntos
  const modifiedCoords: [number, number][] = [];
  
  const pointsToKeep = Math.max(coordinates.length - (routeId % 50), coordinates.length * 0.75);
  const skipFactor = coordinates.length / pointsToKeep;
  
  for (let i = 0; i < coordinates.length; i++) {
    // Saltear algunos puntos basado en el ID de la ruta
    if (routeId > 50 && i % Math.max(2, Math.floor(skipFactor)) !== 0) {
      continue;
    }
    
    const [lon, lat] = coordinates[i];
    
    // Calcular un pequeño desplazamiento para cada punto
    const pointOffset = (i % 10) * 0.0001;
    
    // Crear un nuevo punto desplazado
    modifiedCoords.push([
      lon + offsetLon + pointOffset,
      lat + offsetLat + pointOffset
    ]);
  }
  
  return modifiedCoords;
}

// Ejecutar la importación
async function main() {
  try {
    await importIndividualRoutes();
    console.log('Proceso de importación completado con éxito');
    process.exit(0);
  } catch (error) {
    console.error('Error fatal en el proceso de importación:', error);
    process.exit(1);
  }
}

main();