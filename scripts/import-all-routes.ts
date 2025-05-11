import * as fs from 'fs';
import * as path from 'path';
import * as shapefile from 'shapefile';
import { parseStringPromise } from 'xml2js';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';

// Configuración
const KML_FILE_PATH = './attached_assets/2017-03-04_04-27.kml';
const SHAPEFILE_ZIP_PATH = './attached_assets/shapefiles-mapaton-ciudadano.zip';
const TEMP_DIR = './data/temp';
const OUTPUT_SHAPEFILE_DIR = './data/shapefiles';

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

// Procesar KML directamente 
async function processKmlFile(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Dividir por Placemark para procesar cada ruta
  const placemarks = content.split('<Placemark>').slice(1);
  console.log(`Encontradas ${placemarks.length} elementos en el archivo KML.`);
  
  // Ver el contenido del primer placemark para depuración
  if (placemarks.length > 0) {
    console.log('Primer placemark (fragmento):', placemarks[0].substring(0, 300));
  }
  
  let routeCount = 0;
  let stopCount = 0;
  let routes: any[] = [];
  
  // Primera pasada: procesar las rutas (LineString)
  for (const placemark of placemarks) {
    try {
      // Verificar si es una ruta (tiene LineString) y no una parada (Point)
      if (!placemark.includes('<LineString>')) {
        console.log('No es una ruta (sin LineString)');
        continue;
      }
      
      console.log('Procesando ruta con LineString');
      
      // Extraer nombre
      const nameMatch = placemark.match(/<n>(.*?)<\/n>/);
      if (!nameMatch) {
        // Intentar con otro formato
        const nameMatch2 = placemark.match(/<name>(.*?)<\/name>/);
        if (!nameMatch2) {
          console.log('No se encontró nombre para la ruta');
          continue;
        }
        var name = nameMatch2[1];
      } else {
        var name = nameMatch[1];
      }
      
      console.log('Nombre de ruta encontrado:', name);
      
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
      routes.push(route);
      
      routeCount++;
    } catch (err) {
      console.error('Error procesando ruta:', err);
    }
  }
  
  // Segunda pasada: procesar las paradas (Point) y asociarlas a rutas
  for (const placemark of placemarks) {
    try {
      // Verificar si es una parada (tiene Point) y no una ruta (LineString)
      if (!placemark.includes('<Point>')) {
        continue;
      }
      
      // Extraer metadatos
      let id = '', routeId = '', sequence = '', name = 'Parada';
      
      const idMatch = placemark.match(/<Data name="id"><value>(.*?)<\/value><\/Data>/);
      if (idMatch) id = idMatch[1];
      
      const routeIdMatch = placemark.match(/<Data name="routeId"><value>(.*?)<\/value><\/Data>/);
      if (routeIdMatch) routeId = routeIdMatch[1];
      
      const sequenceMatch = placemark.match(/<Data name="sequence"><value>(.*?)<\/value><\/Data>/);
      if (sequenceMatch) sequence = sequenceMatch[1];
      
      // Extraer coordenadas
      const coordMatch = placemark.match(/<Point><coordinates>(.*?)<\/coordinates><\/Point>/);
      if (!coordMatch) {
        continue;
      }
      
      const parts = coordMatch[1].split(',');
      if (parts.length < 2) {
        continue;
      }
      
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      
      if (isNaN(lon) || isNaN(lat)) {
        continue;
      }
      
      // Encontrar la ruta a la que pertenece
      const route = routes.find(r => r.geoJSON?.properties?.id.toString() === routeId);
      if (!route) {
        continue;
      }
      
      // Determinar si es terminal basado en la secuencia
      const isTerminal = sequence === '0' || (parseInt(sequence) >= 10);
      const terminalType = sequence === '0' ? 'first' : (parseInt(sequence) >= 10 ? 'last' : '');
      
      if (isTerminal) {
        name = `Terminal ${route.name.split('-')[0].trim()}`;
      } else {
        name = `Parada ${sequence}`;
      }
      
      // Crear parada
      await storage.createStop({
        routeId: route.id,
        name: name,
        latitude: lat.toString(),
        longitude: lon.toString(),
        isTerminal: isTerminal,
        terminalType: terminalType
      });
      
      stopCount++;
    } catch (err) {
      console.error('Error procesando parada:', err);
    }
  }
  
  console.log(`Importación de KML completa. ${routeCount} rutas y ${stopCount} paradas importadas.`);
  return { routeCount, stopCount };
}

// Función auxiliar para extraer el ID de la ruta
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

// Función principal para importar todos los datos
async function importAllRoutes() {
  console.log('Iniciando importación de todas las rutas...');
  
  try {
    // Limpiar datos existentes
    await db.delete(busStops);
    await db.delete(busRoutes);
    console.log('Datos anteriores eliminados.');
    
    // Procesar archivo KML
    console.log('Procesando archivo KML principal...');
    const kmlResults = await processKmlFile(KML_FILE_PATH);
    
    console.log(`Importación completa. Total: ${kmlResults.routeCount} rutas y ${kmlResults.stopCount} paradas.`);
  } catch (error) {
    console.error('Error en la importación:', error);
  }
}

// Ejecutar la importación
async function main() {
  try {
    await importAllRoutes();
    console.log('Proceso de importación completado con éxito.');
    process.exit(0);
  } catch (error) {
    console.error('Error fatal en el proceso de importación:', error);
    process.exit(1);
  }
}

main();