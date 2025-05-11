import * as fs from 'fs';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';

// Rutas a los archivos GeoJSON
const ROUTE_GEOJSON_PATH = './attached_assets/2017-03-04_04-27_route.json';
const STOPS_GEOJSON_PATH = './attached_assets/2017-03-04_04-27_stops.json';

// Colores para zonas
const zoneColors: { [key: string]: string } = {
  'norte': '#EF4444', // red-500
  'sur': '#3B82F6',   // blue-500
  'este': '#22C55E',  // green-500
  'oeste': '#A855F7', // purple-500
  'centro': '#F97316' // orange-500
};

async function importGeoJsonData() {
  console.log('Iniciando importación de datos GeoJSON...');
  
  try {
    // Limpiar datos existentes
    await db.delete(busStops);
    await db.delete(busRoutes);
    console.log('Datos anteriores eliminados.');
    
    // Leer los archivos GeoJSON
    const routeFileContent = fs.readFileSync(ROUTE_GEOJSON_PATH, 'utf8');
    const stopsFileContent = fs.readFileSync(STOPS_GEOJSON_PATH, 'utf8');
    
    // Parsear los datos JSON
    const routeData = JSON.parse(routeFileContent);
    const stopsData = JSON.parse(stopsFileContent);
    
    console.log(`Encontradas ${routeData.features.length} rutas en el archivo GeoJSON.`);
    console.log(`Encontradas ${stopsData.features.length} paradas en el archivo GeoJSON.`);
    
    // Diccionario para almacenar las rutas creadas por su ID original
    const routeMap = new Map();
    let routeCount = 0;
    let stopCount = 0;
    
    // Primero procesar e importar las rutas
    for (const feature of routeData.features) {
      if (feature.geometry.type !== 'LineString') {
        continue; // Saltar si no es una ruta (LineString)
      }
      
      // Extraer propiedades y coordenadas
      const properties = feature.properties || {};
      const coordinates = feature.geometry.coordinates;
      
      // Obtener ID de la ruta
      const routeId = properties.id || 10000 + routeCount;
      
      // Determinar nombre y descripción
      let routeName = properties.name || `Ruta ${routeId}`;
      let description = properties.desc || '';
      
      // Si no tiene descripción, extraerla del nombre si es posible
      if (!description && routeName.includes('-')) {
        const parts = routeName.split('-');
        routeName = parts[0].trim();
        description = parts.slice(1).join('-').trim();
      }
      
      // Determinar zona
      const zone = determineZone(description);
      
      // Determinar color (por zona o específico si existe)
      let color = properties.color || zoneColors[zone];
      
      // Crear objeto GeoJSON
      const geoJSON = {
        type: "Feature",
        properties: {
          id: routeId,
          name: routeName,
          shortName: `R${routeId.toString().padStart(3, '0')}`,
          color: color
        },
        geometry: {
          type: "LineString",
          coordinates: coordinates
        }
      };
      
      // Crear registro de ruta
      try {
        const route = await storage.createRoute({
          name: routeName + (description ? ` - ${description}` : ''),
          shortName: `R${routeId.toString().slice(-3)}`,
          color: color,
          frequency: '15 minutos',
          scheduleStart: '05:30 AM',
          scheduleEnd: '10:30 PM',
          stopsCount: Math.max(5, Math.floor(coordinates.length / 20)),
          approximateTime: '45 minutos',
          zone: zone,
          popular: routeCount < 5,
          geoJSON: geoJSON
        });
        
        console.log(`Ruta creada: ${route.name} (ID: ${route.id})`);
        routeMap.set(routeId.toString(), route);
        routeCount++;
      } catch (error) {
        console.error(`Error al crear ruta: ${error}`);
      }
    }
    
    // Luego procesar e importar las paradas
    for (const feature of stopsData.features) {
      if (feature.geometry.type !== 'Point') {
        continue; // Saltar si no es una parada (Point)
      }
      
      // Extraer propiedades y coordenadas
      const properties = feature.properties || {};
      const coordinates = feature.geometry.coordinates;
      
      // Obtener ID de la ruta a la que pertenece la parada
      const routeId = properties.routeId;
      if (!routeId) {
        console.log('Parada sin routeId, omitiendo...');
        continue;
      }
      
      // Buscar la ruta en nuestro mapa
      const route = routeMap.get(routeId);
      if (!route) {
        console.log(`No se encontró la ruta con ID ${routeId} para esta parada, omitiendo...`);
        continue;
      }
      
      // Determinar si es terminal
      const sequence = parseInt(properties.sequence || '0');
      const isTerminal = sequence === 0 || sequence === (stopsData.features.length - 1);
      const terminalType = sequence === 0 ? 'first' : (isTerminal ? 'last' : '');
      
      // Nombre de la parada
      let stopName: string;
      if (isTerminal) {
        if (sequence === 0) {
          stopName = `Terminal Origen`;
        } else {
          stopName = `Terminal Destino`;
        }
      } else {
        stopName = `Parada ${sequence}`;
      }
      
      // Crear registro de parada
      try {
        await storage.createStop({
          routeId: route.id,
          name: stopName,
          latitude: coordinates[1].toString(),
          longitude: coordinates[0].toString(),
          isTerminal: isTerminal,
          terminalType: terminalType
        });
        
        stopCount++;
        if (stopCount % 10 === 0) {
          console.log(`Procesadas ${stopCount} paradas...`);
        }
      } catch (error) {
        console.error(`Error al crear parada: ${error}`);
      }
    }
    
    console.log(`Importación GeoJSON completada: ${routeCount} rutas y ${stopCount} paradas creadas.`);
  } catch (error) {
    console.error('Error en la importación GeoJSON:', error);
  }
}

// Función para determinar la zona basada en la descripción
function determineZone(desc: string): string {
  if (!desc) return 'centro';
  
  const descLower = desc.toLowerCase();
  
  if (descLower.includes('animas') || descLower.includes('camacho') || descLower.includes('lomas')) {
    return 'norte';
  } else if (descLower.includes('2 mil') || descLower.includes('2000') || descLower.includes('trancas')) {
    return 'sur';
  } else if (descLower.includes('uv') || descLower.includes('universidad')) {
    return 'este';
  } else if (descLower.includes('centro')) {
    return 'centro';
  } else if (descLower.includes('coapexpan') || descLower.includes('sumidero')) {
    return 'oeste';
  }
  
  return 'centro';
}

// Ejecutar importación
async function main() {
  try {
    await importGeoJsonData();
    console.log('Proceso de importación GeoJSON completado con éxito');
    process.exit(0);
  } catch (error) {
    console.error('Error fatal en el proceso de importación:', error);
    process.exit(1);
  }
}

main();