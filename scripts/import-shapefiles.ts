import * as fs from 'fs';
import * as path from 'path';
import * as shapefile from 'shapefile';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';

// Configuración
const ROUTES_SHAPEFILE = './data/shapefiles/rutas.shp';
const STOPS_SHAPEFILE = './data/shapefiles/paradas.shp';

// Colores para las zonas
const zoneColors: Record<string, string> = {
  'norte': '#EF4444', // red-500
  'sur': '#3B82F6',   // blue-500
  'este': '#22C55E',  // green-500
  'oeste': '#A855F7', // purple-500
  'centro': '#F97316' // orange-500
};

// Función para convertir un shapefile de rutas a GeoJSON y guardar en la base de datos
async function importRoutes() {
  console.log('Importando rutas de autobús...');
  
  try {
    // Leer el shapefile
    const source = await shapefile.open(ROUTES_SHAPEFILE);
    let routesCount = 0;
    
    // Limpiar todas las rutas existentes
    await db.delete(busRoutes);
    console.log('Rutas anteriores eliminadas de la base de datos.');
    
    // Iterar sobre cada característica
    while (true) {
      const result = await source.read();
      if (result.done) break;
      
      const feature = result.value;
      const { properties, geometry } = feature;
      
      // Asignar una zona basada en alguna propiedad (esto es un ejemplo, ajusta según tus datos)
      const zone = determineZone(properties);
      
      // Crear nombre corto para la ruta
      const shortName = generateShortName(properties.nombre || `Ruta ${routesCount + 1}`);
      
      // Generar horario aproximado (ajustar según datos reales)
      const scheduleStart = '05:30 AM';
      const scheduleEnd = '10:30 PM';
      
      // Estimar paradas basadas en la longitud de la ruta
      const stopsCount = Math.max(10, Math.floor(geometry.coordinates.length / 3));
      
      // Estimar tiempo aproximado basado en la longitud de la ruta
      const approximateTime = generateApproximateTime(geometry.coordinates.length);
      
      // Generar frecuencia (ajustar según datos reales)
      const frequency = generateFrequency();
      
      // Crear un objeto GeoJSON para la ruta
      const geoJSON = {
        type: "Feature",
        properties: {
          id: routesCount + 1,
          name: properties.nombre || `Ruta ${routesCount + 1}`,
          shortName: shortName,
          color: zoneColors[zone] || '#3B82F6'
        },
        geometry: geometry
      };
      
      // Crear registro de ruta
      await storage.createRoute({
        name: properties.nombre || `Ruta ${routesCount + 1}`,
        shortName: shortName,
        color: zoneColors[zone] || '#3B82F6',
        frequency: frequency,
        scheduleStart: scheduleStart,
        scheduleEnd: scheduleEnd,
        stopsCount: stopsCount,
        approximateTime: approximateTime,
        zone: zone,
        popular: routesCount < 5, // Marcar algunas rutas como populares
        geoJSON: geoJSON
      });
      
      routesCount++;
      if (routesCount % 10 === 0) {
        console.log(`Procesadas ${routesCount} rutas...`);
      }
    }
    
    console.log(`Importación completa. ${routesCount} rutas importadas.`);
  } catch (error) {
    console.error('Error importando rutas:', error);
  }
}

// Función para importar paradas
async function importStops() {
  console.log('Importando paradas de autobús...');
  
  try {
    // Leer el shapefile
    const source = await shapefile.open(STOPS_SHAPEFILE);
    let stopsCount = 0;
    
    // Limpiar todas las paradas existentes
    await db.delete(busStops);
    console.log('Paradas anteriores eliminadas de la base de datos.');
    
    // Obtener todas las rutas
    const routes = await storage.getAllRoutes();
    const routeMap = new Map(routes.map(route => [route.id, route]));
    
    // Iterar sobre cada característica
    while (true) {
      const result = await source.read();
      if (result.done) break;
      
      const feature = result.value;
      const { properties, geometry } = feature;
      
      // Encontrar a qué ruta pertenece esta parada
      const routeId = determineRouteForStop(properties, routes);
      
      if (routeId) {
        // Determinar si es una terminal
        const isTerminal = properties.isTerminal === true || properties.isTerminal === 'true';
        const terminalType = isTerminal ? (Math.random() > 0.5 ? 'first' : 'last') : '';
        
        // Crear registro de parada
        await storage.createStop({
          routeId: routeId,
          name: properties.nombre || `Parada ${stopsCount + 1}`,
          latitude: geometry.coordinates[1].toString(),
          longitude: geometry.coordinates[0].toString(),
          isTerminal: isTerminal,
          terminalType: terminalType
        });
        
        stopsCount++;
        if (stopsCount % 50 === 0) {
          console.log(`Procesadas ${stopsCount} paradas...`);
        }
      }
    }
    
    console.log(`Importación completa. ${stopsCount} paradas importadas.`);
  } catch (error) {
    console.error('Error importando paradas:', error);
  }
}

// Función auxiliar para determinar la zona de una ruta
function determineZone(properties: any): string {
  // Esta función está adaptada para los datos de Mapaton.org
  const zones = ['norte', 'sur', 'este', 'oeste', 'centro'];
  
  // Mapaton puede tener información sobre la región o área
  if (properties.region || properties.area || properties.zona) {
    const regionName = (properties.region || properties.area || properties.zona || '').toLowerCase();
    
    // Mapeamos regiones típicas de Xalapa a nuestras zonas
    if (regionName.includes('norte') || regionName.includes('animas')) {
      return 'norte';
    } else if (regionName.includes('sur') || regionName.includes('trancas')) {
      return 'sur';
    } else if (regionName.includes('este') || regionName.includes('universidad')) {
      return 'este';
    } else if (regionName.includes('oeste') || regionName.includes('coapexpan')) {
      return 'oeste';
    } else if (regionName.includes('centro')) {
      return 'centro';
    }
  }
  
  // Si no podemos determinar la zona por el nombre de región, usamos el origen/destino
  if (properties.origen && properties.destino) {
    const routePath = `${properties.origen} ${properties.destino}`.toLowerCase();
    
    if (routePath.includes('centro')) {
      return 'centro';
    } else if (routePath.includes('universidad') || routePath.includes('usbi')) {
      return 'este';
    } else if (routePath.includes('animas') || routePath.includes('museo')) {
      return 'norte';
    } else if (routePath.includes('trancas') || routePath.includes('soriana')) {
      return 'sur';
    } else if (routePath.includes('coapexpan') || routePath.includes('sumidero')) {
      return 'oeste';
    }
  }
  
  // Si todo lo demás falla, asignamos una zona basada en el ID de ruta o aleatoriamente
  if (properties.id || properties.ID || properties.route_id) {
    const routeId = parseInt(properties.id || properties.ID || properties.route_id);
    return zones[routeId % zones.length];
  }
  
  // Fallback final: zona aleatoria
  return zones[Math.floor(Math.random() * zones.length)];
}

// Función auxiliar para generar un nombre corto para la ruta
function generateShortName(routeName: string): string {
  // Específicamente para Mapaton: buscar patrones comunes de nomenclatura
  
  // Patrón: números en el nombre de la ruta
  const numMatch = routeName.match(/(\d+)/);
  if (numMatch && numMatch[1]) {
    return `R${numMatch[1]}`;
  }
  
  // Patrón: formato "NOMBRE - DESTINO" o "NOMBRE → DESTINO"
  const directionMatch = routeName.match(/(.+?)(?:\s*[-→]\s*)(.+)/);
  if (directionMatch) {
    // Tomar la primera letra de cada parte
    return `${directionMatch[1].charAt(0)}${directionMatch[2].charAt(0)}`.toUpperCase();
  }
  
  // Si hay "ORIGEN-DESTINO" sin guiones especiales
  const parts = routeName.split(/\s+/).filter(word => word.length > 0);
  if (parts.length >= 2) {
    // Usar primeras letras de las dos palabras principales
    return `${parts[0].charAt(0)}${parts[parts.length-1].charAt(0)}`.toUpperCase();
  }
  
  // Fallback: primeras dos letras
  return routeName.substring(0, 2).toUpperCase();
}

// Función auxiliar para generar tiempo aproximado
function generateApproximateTime(coordinatesLength: number): string {
  // Estimar tiempo basado en la longitud de la ruta
  const minutes = Math.max(15, Math.min(90, Math.floor(coordinatesLength / 2)));
  if (minutes < 60) {
    return `${minutes} minutos`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}min`;
  }
}

// Función auxiliar para generar frecuencia
function generateFrequency(): string {
  const frequencies = [
    '10 minutos',
    '15 minutos',
    '20 minutos',
    '30 minutos',
    '45 minutos',
    '60 minutos'
  ];
  return frequencies[Math.floor(Math.random() * frequencies.length)];
}

// Función auxiliar para determinar a qué ruta pertenece una parada
function determineRouteForStop(stopProperties: any, routes: any[]): number | null {
  // Esta función está adaptada para los datos de Mapaton.org
  
  // Comprobamos si hay identificadores de ruta en los datos
  if (stopProperties.route_id || stopProperties.routeId || stopProperties.ruta_id) {
    const routeId = parseInt(stopProperties.route_id || stopProperties.routeId || stopProperties.ruta_id);
    const route = routes.find(r => r.id === routeId);
    if (route) return route.id;
  }
  
  // Comprobamos si hay un nombre de ruta que podamos relacionar
  if (stopProperties.route_name || stopProperties.ruta || stopProperties.linea) {
    const routeName = (stopProperties.route_name || stopProperties.ruta || stopProperties.linea || '').toLowerCase();
    const matchedRoute = routes.find(r => r.name.toLowerCase().includes(routeName) || routeName.includes(r.name.toLowerCase()));
    if (matchedRoute) return matchedRoute.id;
  }
  
  // Podemos intentar determinar la ruta por la cercanía geográfica de la parada a la ruta
  // Pero esto requeriría cálculos espaciales complejos que no implementamos aquí
  
  // Si la parada tiene información sobre origen/destino, tratamos de emparejarla con rutas similares
  if (stopProperties.origen || stopProperties.destino) {
    const stopLocation = `${stopProperties.origen || ''} ${stopProperties.destino || ''}`.toLowerCase();
    
    // Buscar rutas con destinos/orígenes similares
    for (const route of routes) {
      if (route.name.toLowerCase().includes(stopLocation) || 
          (typeof route.geoJSON === 'object' && 
           route.geoJSON.properties && 
           `${route.geoJSON.properties.origen || ''} ${route.geoJSON.properties.destino || ''}`.toLowerCase().includes(stopLocation))) {
        return route.id;
      }
    }
  }
  
  // Si todo lo demás falla, asignamos la parada a una ruta de la misma zona (si la parada tiene zona)
  if (stopProperties.zona || stopProperties.region || stopProperties.area) {
    const stopZone = determineZone(stopProperties);
    const zoneRoutes = routes.filter(r => r.zone === stopZone);
    
    if (zoneRoutes.length > 0) {
      return zoneRoutes[Math.floor(Math.random() * zoneRoutes.length)].id;
    }
  }
  
  // Último recurso: asignar a una ruta aleatoria
  if (routes.length > 0) {
    return routes[Math.floor(Math.random() * routes.length)].id;
  }
  
  return null;
}

// Ejecutar la importación
async function main() {
  try {
    await importRoutes();
    await importStops();
    console.log('Proceso de importación completado.');
    process.exit(0);
  } catch (error) {
    console.error('Error en el proceso de importación:', error);
    process.exit(1);
  }
}

main();