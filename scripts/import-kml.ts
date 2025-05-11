import * as fs from 'fs';
import * as path from 'path';
import { parseStringPromise } from 'xml2js';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';

// Configuración
const KML_FILE_PATH = './data/rutas-xalapa.kml';

// Colores para las zonas
const zoneColors: Record<string, string> = {
  'norte': '#EF4444', // red-500
  'sur': '#3B82F6',   // blue-500
  'este': '#22C55E',  // green-500
  'oeste': '#A855F7', // purple-500
  'centro': '#F97316' // orange-500
};

// Colores para rutas específicas (basado en las notas en el KML)
const routeColors: Record<string, string> = {
  'Amarillo': '#FFCC00',
  'Azul': '#0066CC',
  'Rojo': '#CC0000',
  'Verde': '#00CC33',
  'Naranja': '#FF6600',
  'Morado': '#9900CC',
  'Blanco': '#FFFFFF',
  'Negro': '#333333',
  'Gris': '#999999',
  'Café': '#663300'
};

// Función para extraer el ID de la ruta (por ejemplo, "Ruta 10001" -> 10001)
function extractRouteId(name: string): number {
  const match = name.match(/Ruta\s+(\d+)/i);
  return match ? parseInt(match[1]) : 0;
}

// Función para determinar la zona basada en la descripción
function determineZone(desc: string): string {
  const zones = ['norte', 'sur', 'este', 'oeste', 'centro'];
  
  const descLower = desc.toLowerCase();
  
  if (descLower.includes('camacho') || descLower.includes('lomas verdes') || descLower.includes('animas')) {
    return 'norte';
  } else if (descLower.includes('sumidero') || descLower.includes('coapexpan')) {
    return 'oeste';
  } else if (descLower.includes('zona uv') || descLower.includes('universidad')) {
    return 'este';
  } else if (descLower.includes('centro')) {
    return 'centro';
  } else if (descLower.includes('trancas') || descLower.includes('xalapa 2000')) {
    return 'sur';
  }
  
  // Si no podemos determinar, asignar aleatoriamente
  return zones[Math.floor(Math.random() * zones.length)];
}

// Función para generar horarios basados en la información de frecuencias
function generateSchedule(peakAM: string, midday: string, peakPM: string, night: string): { 
  start: string, 
  end: string, 
  frequency: string,
  approximateTime: string 
} {
  // Convertir a números, o usar valores predeterminados si no hay datos
  const peakAMMin = parseInt(peakAM) || 10;
  const middayMin = parseInt(midday) || 15;
  const peakPMMin = parseInt(peakPM) || 10;
  const nightMin = parseInt(night) || 20;
  
  // Calcular la frecuencia promedio (redondeada a 5 min)
  const avgFrequency = Math.round((peakAMMin + middayMin + peakPMMin + nightMin) / 4 / 5) * 5;
  
  // Ajustar los horarios de inicio y fin basados en el servicio nocturno
  let startTime = '05:30 AM';
  let endTime = nightMin > 0 ? '10:30 PM' : '09:00 PM';
  
  // Tiempo aproximado de viaje (estimación)
  const approximateTime = `${30 + Math.floor(Math.random() * 30)} minutos`;
  
  return {
    start: startTime,
    end: endTime,
    frequency: `${avgFrequency} minutos`,
    approximateTime
  };
}

// Función para convertir coordenadas KML a formato GeoJSON
function convertCoordinatesToGeoJSON(coordinatesStr: string): [number, number][] {
  // Las coordenadas en KML están en formato: lon,lat,ele lon,lat,ele ...
  // o pueden estar separadas por espacio y/o nuevas líneas
  return coordinatesStr.trim()
    .split(/\s+/) // Dividir por espacios, tabulaciones, o saltos de línea
    .filter(coord => coord.trim() !== '')
    .map(coordPair => {
      const parts = coordPair.split(',');
      if (parts.length < 2) {
        console.warn('Coordenada inválida:', coordPair);
        return null;
      }
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (isNaN(lon) || isNaN(lat)) {
        console.warn('Valores de coordenada no numéricos:', coordPair);
        return null;
      }
      return [lon, lat] as [number, number];
    })
    .filter(coord => coord !== null) as [number, number][];
}

// Función principal para importar datos KML
async function importKML() {
  console.log('Importando datos de KML...');
  
  try {
    // Leer el archivo KML
    const kmlContent = fs.readFileSync(KML_FILE_PATH, 'utf8');
    console.log(`Archivo KML leído: ${kmlContent.length} caracteres`);
    
    // Parsear el XML a un objeto JavaScript
    const result = await parseStringPromise(kmlContent, { explicitArray: false });
    
    // Verificar la estructura del KML
    console.log('Estructura de KML:', Object.keys(result));
    if (!result.kml) {
      console.error('No se encontró el elemento kml en el archivo');
      return;
    }
    console.log('Estructura kml:', Object.keys(result.kml));
    if (!result.kml.Document) {
      console.error('No se encontró el elemento Document en el archivo');
      return;
    }
    console.log('Estructura Document:', Object.keys(result.kml.Document));
    
    // Eliminar datos existentes
    await db.delete(busStops);
    await db.delete(busRoutes);
    console.log('Datos anteriores eliminados.');
    
    // Obtener todas las rutas
    let placemarks = result.kml.Document.Placemark;
    
    // Verificar que hay placemarks
    if (!placemarks) {
      console.error('No se encontraron Placemarks en el archivo KML');
      return;
    }
    
    if (!Array.isArray(placemarks)) {
      console.log('Placemarks no es un array, convirtiéndolo...');
      placemarks = [placemarks];
    }
    
    console.log(`Encontradas ${placemarks.length} rutas en el archivo KML.`);
    
    // Procesar cada ruta
    let routeCount = 0;
    
    for (const placemark of placemarks) {
      try {
        // Obtener propiedades básicas
        const name = placemark.name;
        
        // Si no es una ruta, continuar
        if (!name || !name.toLowerCase().includes('ruta')) continue;
        
        // Obtener datos extendidos
        let desc = '';
        let notes = '';
        let peakAM = '10';
        let midday = '15';
        let peakPM = '10';
        let night = '20';
        
        if (placemark.ExtendedData && placemark.ExtendedData.Data) {
          const dataList = Array.isArray(placemark.ExtendedData.Data) ? 
            placemark.ExtendedData.Data : [placemark.ExtendedData.Data];
            
          for (const data of dataList) {
            if (data.$.name === 'desc' && data.value) desc = data.value;
            if (data.$.name === 'notes' && data.value) notes = data.value;
            if (data.$.name === 'peak_am' && data.value) peakAM = data.value;
            if (data.$.name === 'midday' && data.value) midday = data.value;
            if (data.$.name === 'peak_pm' && data.value) peakPM = data.value;
            if (data.$.name === 'night' && data.value) night = data.value;
          }
        }
        
        // Obtener coordenadas
        let coordinates: [number, number][] = [];
        if (placemark.LineString && placemark.LineString.coordinates) {
          coordinates = convertCoordinatesToGeoJSON(placemark.LineString.coordinates);
        }
        
        if (coordinates.length < 2) {
          console.warn(`Ruta ${name} no tiene suficientes coordenadas. Omitiendo.`);
          continue;
        }
        
        // Determinar la zona y el color
        const zone = determineZone(desc);
        let color = zoneColors[zone];
        
        // Si hay una nota de color específica, usarla
        if (notes && routeColors[notes]) {
          color = routeColors[notes];
        }
        
        // Generar información de horarios
        const schedule = generateSchedule(peakAM, midday, peakPM, night);
        
        // Generar nombre corto para la ruta
        const routeId = extractRouteId(name);
        const shortName = `R${routeId}`;
        
        // Estimar paradas basadas en la longitud de la ruta
        const stopsCount = Math.max(10, Math.floor(coordinates.length / 15));
        
        // Crear un objeto GeoJSON para la ruta
        const geoJSON = {
          type: "Feature",
          properties: {
            id: routeId,
            name: name,
            shortName: shortName,
            color: color,
            desc: desc
          },
          geometry: {
            type: "LineString",
            coordinates: coordinates
          }
        };
        
        // Crear registro de ruta
        const routeData = {
          name: name + (desc ? ` - ${desc}` : ''),
          shortName: shortName,
          color: color,
          frequency: schedule.frequency,
          scheduleStart: schedule.start,
          scheduleEnd: schedule.end,
          stopsCount: stopsCount,
          approximateTime: schedule.approximateTime,
          zone: zone,
          popular: routeCount < 5, // Marcar las primeras 5 rutas como populares
          geoJSON: geoJSON
        };
        
        const route = await storage.createRoute(routeData);
        console.log(`Ruta creada: ${route.name} (${route.shortName})`);
        
        // Generar paradas para esta ruta
        const step = Math.max(3, Math.floor(coordinates.length / stopsCount));
        
        // Primera parada (terminal de origen)
        await storage.createStop({
          routeId: route.id,
          name: `Terminal ${desc.split('/')[0]?.trim() || 'Origen'}`,
          latitude: coordinates[0][1].toString(),
          longitude: coordinates[0][0].toString(),
          isTerminal: true,
          terminalType: 'first'
        });
        
        // Paradas intermedias
        for (let i = step; i < coordinates.length - step; i += step) {
          await storage.createStop({
            routeId: route.id,
            name: `Parada ${Math.floor(i/step)}`,
            latitude: coordinates[i][1].toString(),
            longitude: coordinates[i][0].toString(),
            isTerminal: false,
            terminalType: ''
          });
        }
        
        // Última parada (terminal destino)
        const lastCoord = coordinates[coordinates.length - 1];
        await storage.createStop({
          routeId: route.id,
          name: `Terminal ${desc.split('/').pop()?.trim() || 'Destino'}`,
          latitude: lastCoord[1].toString(),
          longitude: lastCoord[0].toString(),
          isTerminal: true,
          terminalType: 'last'
        });
        
        routeCount++;
        
        if (routeCount % 10 === 0) {
          console.log(`Procesadas ${routeCount} rutas...`);
        }
      } catch (err) {
        console.error(`Error procesando ruta: ${placemark.name || 'sin nombre'}`, err);
      }
    }
    
    console.log(`Importación completa. ${routeCount} rutas importadas.`);
  } catch (error) {
    console.error('Error importando datos KML:', error);
  }
}

// Ejecutar la importación
async function main() {
  try {
    await importKML();
    console.log('Proceso de importación completado.');
    process.exit(0);
  } catch (error) {
    console.error('Error en el proceso de importación:', error);
    process.exit(1);
  }
}

main();