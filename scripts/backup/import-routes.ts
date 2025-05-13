import * as fs from 'fs';
import { parseStringPromise } from 'xml2js';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';

// Configuración
const KML_FILE_PATH = './data/rutas-xalapa-fixed.kml';

// Colores para las zonas
const zoneColors: Record<string, string> = {
  'norte': '#EF4444', // red-500
  'sur': '#3B82F6',   // blue-500
  'este': '#22C55E',  // green-500
  'oeste': '#A855F7', // purple-500
  'centro': '#F97316' // orange-500
};

// Colores para rutas específicas
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

// Extraer ID de ruta del nombre
function extractRouteId(name: string): number {
  const match = name.match(/Ruta\s+(\d+)/i);
  if (match) {
    return parseInt(match[1]);
  }
  
  const numMatch = name.match(/(\d+)/);
  if (numMatch) {
    return parseInt(numMatch[1]);
  }
  
  return Math.floor(Math.random() * 1000) + 1000;
}

// Determinar zona
function determineZone(desc: string): string {
  if (!desc) return 'centro';
  
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
  
  const zones = ['norte', 'sur', 'este', 'oeste', 'centro'];
  return zones[Math.floor(Math.random() * zones.length)];
}

// Generar horarios
function generateSchedule(peakAM: string, midday: string, peakPM: string, night: string): { 
  start: string, 
  end: string, 
  frequency: string,
  approximateTime: string 
} {
  const peakAMMin = parseInt(peakAM) || 10;
  const middayMin = parseInt(midday) || 15;
  const peakPMMin = parseInt(peakPM) || 10;
  const nightMin = parseInt(night) || 20;
  
  const avgFrequency = Math.round((peakAMMin + middayMin + peakPMMin + nightMin) / 4 / 5) * 5;
  
  let startTime = '05:30 AM';
  let endTime = nightMin > 0 ? '10:30 PM' : '09:00 PM';
  
  const approximateTime = `${30 + Math.floor(Math.random() * 30)} minutos`;
  
  return {
    start: startTime,
    end: endTime,
    frequency: `${avgFrequency} minutos`,
    approximateTime
  };
}

// Función principal de importación
async function importRoutes() {
  console.log('Importando rutas desde KML...');
  
  try {
    // Leer y corregir el archivo KML
    let kmlContent = fs.readFileSync('./data/rutas-xalapa.kml', 'utf8');
    kmlContent = kmlContent.replace(/<n>/g, '<name>').replace(/<\/n>/g, '</name>');
    fs.writeFileSync('./data/rutas-xalapa-fixed.kml', kmlContent);
    console.log('Archivo KML corregido');
    
    // Leer el archivo corregido
    const xmlData = fs.readFileSync(KML_FILE_PATH, 'utf8');
    
    // Parsear XML
    const result = await parseStringPromise(xmlData, { explicitArray: false });
    
    // Limpiar datos existentes
    await db.delete(busStops);
    await db.delete(busRoutes);
    console.log('Datos anteriores eliminados');
    
    // Verificar estructura
    if (!result.kml || !result.kml.Document || !result.kml.Document.Placemark) {
      console.error('Estructura KML inesperada');
      return;
    }
    
    // Obtener placemarks
    let placemarks = result.kml.Document.Placemark;
    if (!Array.isArray(placemarks)) {
      placemarks = [placemarks];
    }
    
    console.log(`Encontradas ${placemarks.length} rutas potenciales`);
    
    let routeCount = 0;
    
    // Procesar cada placemark
    for (const placemark of placemarks) {
      try {
        // Extraer nombre
        if (!placemark.name || !placemark.name.toLowerCase().includes('ruta')) {
          console.log(`Omitiendo placemark sin nombre de ruta: ${placemark.name || 'sin nombre'}`);
          continue;
        }
        
        const name = placemark.name;
        
        // Extraer metadatos
        let id = '', desc = '', notes = '', peakAM = '10', midday = '15', peakPM = '10', night = '20';
        
        if (placemark.ExtendedData && placemark.ExtendedData.Data) {
          const dataList = Array.isArray(placemark.ExtendedData.Data) 
            ? placemark.ExtendedData.Data 
            : [placemark.ExtendedData.Data];
          
          for (const data of dataList) {
            if (data && data.$ && data.$.name) {
              if (data.$.name === 'id' && data.value) id = data.value;
              if (data.$.name === 'desc' && data.value) desc = data.value;
              if (data.$.name === 'notes' && data.value) notes = data.value;
              if (data.$.name === 'peak_am' && data.value) peakAM = data.value;
              if (data.$.name === 'midday' && data.value) midday = data.value;
              if (data.$.name === 'peak_pm' && data.value) peakPM = data.value;
              if (data.$.name === 'night' && data.value) night = data.value;
            }
          }
        }
        
        // Extraer y procesar coordenadas
        if (!placemark.LineString || !placemark.LineString.coordinates) {
          console.warn(`La ruta ${name} no tiene coordenadas. Omitiendo.`);
          continue;
        }
        
        // Procesar coordenadas
        const coordsStr = placemark.LineString.coordinates;
        const coordinates = coordsStr
          .split(/\s+/)
          .map(coordStr => {
            const parts = coordStr.split(',');
            if (parts.length < 2) return null;
            return [parseFloat(parts[0]), parseFloat(parts[1])] as [number, number];
          })
          .filter(coord => coord !== null && !isNaN(coord[0]) && !isNaN(coord[1])) as [number, number][];
        
        if (coordinates.length < 2) {
          console.warn(`La ruta ${name} no tiene suficientes coordenadas válidas`);
          continue;
        }
        
        // Determinar zona y color
        const zone = determineZone(desc);
        let color = zoneColors[zone];
        
        if (notes && routeColors[notes]) {
          color = routeColors[notes];
        }
        
        // Generar horarios
        const schedule = generateSchedule(peakAM, midday, peakPM, night);
        
        // Extraer ID y generar nombre corto
        const routeId = extractRouteId(name);
        const shortName = `R${routeId}`;
        
        // Crear objeto GeoJSON
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
          stopsCount: Math.max(10, Math.floor(coordinates.length / 15)),
          approximateTime: schedule.approximateTime,
          zone: zone,
          popular: routeCount < 5,
          geoJSON: geoJSON
        };
        
        const route = await storage.createRoute(routeData);
        console.log(`Ruta creada: ${route.name} (${route.shortName})`);
        
        // Generar paradas
        const stopsCount = Math.max(5, Math.min(20, Math.floor(coordinates.length / 20)));
        const step = Math.max(3, Math.floor(coordinates.length / stopsCount));
        
        // Terminal de origen
        await storage.createStop({
          routeId: route.id,
          name: `Terminal ${desc?.split('/')[0]?.trim() || 'Origen'}`,
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
        
        // Terminal destino
        const lastCoord = coordinates[coordinates.length - 1];
        await storage.createStop({
          routeId: route.id,
          name: `Terminal ${desc?.split('/')?.pop()?.trim() || 'Destino'}`,
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
        console.error(`Error procesando ruta:`, err);
      }
    }
    
    console.log(`Importación completa. ${routeCount} rutas importadas.`);
  } catch (error) {
    console.error('Error en la importación:', error);
  }
}

// Ejecutar
async function main() {
  try {
    await importRoutes();
    console.log('Proceso de importación completado.');
    process.exit(0);
  } catch (error) {
    console.error('Error en el proceso:', error);
    process.exit(1);
  }
}

main();