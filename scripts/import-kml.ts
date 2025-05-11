import * as fs from 'fs';
import * as path from 'path';
import { parseStringPromise } from 'xml2js';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';

// Función para procesar directamente el XML como texto para manejar el formato específico
async function processKmlFile(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Eliminar datos existentes
  await db.delete(busStops);
  await db.delete(busRoutes);
  console.log('Datos anteriores eliminados.');
  
  // Dividir por Placemark para procesar cada ruta
  const placemarks = content.split('<Placemark>').slice(1);
  console.log(`Encontradas ${placemarks.length} rutas potenciales en el archivo KML.`);
  
  let routeCount = 0;
  
  for (const placemark of placemarks) {
    try {
      // Depuración
      if (routeCount === 0) {
        console.log('Ejemplo del primer placemark:', placemark.substring(0, 300));
      }
      
      // Extraer nombre
      const nameMatch = placemark.match(/<n>(.*?)<\/n>/);
      if (!nameMatch) {
        console.warn('No se pudo encontrar el nombre de la ruta. Intentando con name');
        const nameMatch2 = placemark.match(/<name>(.*?)<\/name>/);
        if (!nameMatch2) {
          console.warn('No se pudo encontrar ningún nombre para esta ruta. Omitiendo.');
          continue;
        }
        var name = nameMatch2[1];
      } else {
        var name = nameMatch[1];
      }
      
      // Extraer metadatos
      let id = '', desc = '', notes = '', peakAM = '10', midday = '15', peakPM = '10', night = '20';
      
      const idMatch = placemark.match(/<Data name="id"><value>(.*?)<\/value><\/Data>/);
      if (idMatch) id = idMatch[1];
      
      const descMatch = placemark.match(/<Data name="desc"><value>(.*?)<\/value><\/Data>/);
      if (descMatch) desc = descMatch[1];
      
      const notesMatch = placemark.match(/<Data name="notes"><value>(.*?)<\/value><\/Data>/);
      if (notesMatch) notes = notesMatch[1];
      
      const peakAMMatch = placemark.match(/<Data name="peak_am"><value>(.*?)<\/value><\/Data>/);
      if (peakAMMatch) peakAM = peakAMMatch[1];
      
      const middayMatch = placemark.match(/<Data name="midday"><value>(.*?)<\/value><\/Data>/);
      if (middayMatch) midday = middayMatch[1];
      
      const peakPMMatch = placemark.match(/<Data name="peak_pm"><value>(.*?)<\/value><\/Data>/);
      if (peakPMMatch) peakPM = peakPMMatch[1];
      
      const nightMatch = placemark.match(/<Data name="night"><value>(.*?)<\/value><\/Data>/);
      if (nightMatch) night = nightMatch[1];
      
      // Extraer coordenadas
      const coordMatch = placemark.match(/<LineString><coordinates>([\s\S]*?)<\/coordinates><\/LineString>/);
      if (!coordMatch) {
        console.warn(`No se encontraron coordenadas para la ruta ${name}`);
        continue;
      }
      
      // Procesar coordenadas (pueden estar en múltiples líneas)
      const coordsText = coordMatch[1].trim();
      const coordinates = coordsText.split(/\s+/)
        .map(line => {
          const parts = line.trim().split(',');
          if (parts.length < 2) return null;
          
          const lon = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          
          if (isNaN(lon) || isNaN(lat)) return null;
          return [lon, lat] as [number, number];
        })
        .filter(coord => coord !== null) as [number, number][];
      
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
      
      // Extraer ID de ruta del nombre
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
        popular: routeCount < 5, // Primeras 5 son populares
        geoJSON: geoJSON
      };
      
      const route = await storage.createRoute(routeData);
      console.log(`Ruta creada: ${route.name} (${route.shortName})`);
      
      // Crear paradas
      const stopsCount = Math.max(10, Math.floor(coordinates.length / 15));
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
      console.error('Error procesando ruta:', err);
    }
  }
  
  console.log(`Importación completa. ${routeCount} rutas importadas.`);
  return routeCount;
}

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
  // Buscar patrones como "Ruta 10001"
  const match = name.match(/Ruta\s+(\d+)/i);
  if (match) {
    return parseInt(match[1]);
  }
  
  // Si no encuentra el formato esperado, extraer cualquier número en el nombre
  const numMatch = name.match(/(\d+)/);
  if (numMatch) {
    return parseInt(numMatch[1]);
  }
  
  // Si no hay números, generar un ID aleatorio
  return Math.floor(Math.random() * 1000) + 1000;
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
    // Usar el enfoque directo para procesar el archivo KML
    await processKmlFile(KML_FILE_PATH);
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