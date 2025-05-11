import * as fs from 'fs';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';

// Archivo KML principal
const KML_FILE_PATH = './attached_assets/2017-03-04_04-27.kml';

// Colores para zonas
const zoneColors: { [key: string]: string } = {
  'norte': '#EF4444', // red-500
  'sur': '#3B82F6',   // blue-500
  'este': '#22C55E',  // green-500
  'oeste': '#A855F7', // purple-500
  'centro': '#F97316' // orange-500
};

// Colores para rutas específicas
const routeColors: { [key: string]: string } = {
  'Amarillo': '#FFCC00',
  'Azul': '#0066CC',
  'Rojo': '#CC0000',
  'Verde': '#00CC33',
  'Naranja': '#FF6600',
  'Morado': '#9900CC',
  'Blanco': '#FFFFFF',
  'Negro': '#333333'
};

async function importKML() {
  console.log('Iniciando importación desde KML...');
  
  try {
    // Limpiar datos existentes
    await db.delete(busStops);
    await db.delete(busRoutes);
    console.log('Datos anteriores eliminados.');
    
    // Leer el archivo KML
    const kmlContent = fs.readFileSync(KML_FILE_PATH, 'utf8');
    
    // Obtener todos los placemarks
    const placemarks = kmlContent.split('<Placemark>').slice(1);
    console.log(`Se encontraron ${placemarks.length} placemarks en el archivo KML.`);
    
    // Almacenar rutas creadas para asociar paradas después
    const routesMap = new Map();
    let routeCount = 0;
    let stopCount = 0;
    
    // Primera pasada: crear rutas (LineString)
    for (let i = 0; i < placemarks.length; i++) {
      const placemark = placemarks[i];
      
      // Si no tiene LineString, no es una ruta
      if (!placemark.includes('<LineString>')) {
        continue;
      }
      
      // Extraer etiqueta de nombre
      // En este archivo, el nombre de la ruta está en una etiqueta <n>
      const nameMatch = placemark.match(/<n>(.*?)<\/n>/);
      if (!nameMatch) {
        console.log(`Placemark ${i} sin etiqueta de nombre <n>, omitiendo...`);
        console.log(placemark.substring(0, 100) + '...');
        continue;
      }
      
      const routeName = nameMatch[1];
      console.log(`Procesando ruta: ${routeName}`);
      
      // Extraer ID
      let routeId = 0;
      const idMatch = placemark.match(/<Data name="id"><value>(.*?)<\/value><\/Data>/);
      if (idMatch) {
        routeId = parseInt(idMatch[1]);
      } else {
        // Usar número de la ruta como ID
        const numMatch = routeName.match(/(\d+)/);
        if (numMatch) {
          routeId = parseInt(numMatch[1]);
        } else {
          routeId = 10000 + i; // ID único por posición
        }
      }
      
      // Extraer descripción
      let description = '';
      const descMatch = placemark.match(/<Data name="desc"><value>(.*?)<\/value><\/Data>/);
      if (descMatch) {
        description = descMatch[1];
      }
      
      // Extraer color o notas
      let color = '#3B82F6'; // Color por defecto
      const notesMatch = placemark.match(/<Data name="notes"><value>(.*?)<\/value><\/Data>/);
      if (notesMatch && routeColors[notesMatch[1]]) {
        color = routeColors[notesMatch[1]];
      } else {
        // Sin notas de color, usar color por zona
        const zone = determineZone(description);
        color = zoneColors[zone];
      }
      
      // Extraer frecuencias para horarios
      let peakAM = '10', midday = '15', peakPM = '10', night = '20';
      
      const peakAMMatch = placemark.match(/<Data name="peak_am"><value>(.*?)<\/value><\/Data>/);
      if (peakAMMatch) peakAM = peakAMMatch[1];
      
      const middayMatch = placemark.match(/<Data name="midday"><value>(.*?)<\/value><\/Data>/);
      if (middayMatch) midday = middayMatch[1];
      
      const peakPMMatch = placemark.match(/<Data name="peak_pm"><value>(.*?)<\/value><\/Data>/);
      if (peakPMMatch) peakPM = peakPMMatch[1];
      
      const nightMatch = placemark.match(/<Data name="night"><value>(.*?)<\/value><\/Data>/);
      if (nightMatch) night = nightMatch[1];
      
      // Generar horarios basados en frecuencias
      const schedule = generateSchedule(peakAM, midday, peakPM, night);
      
      // Extraer coordenadas
      const coordMatch = placemark.match(/<LineString><coordinates>([\s\S]*?)<\/coordinates><\/LineString>/);
      if (!coordMatch) {
        console.log(`No se encontraron coordenadas para la ruta ${routeName}`);
        continue;
      }
      
      // Procesar coordenadas
      const coordsText = coordMatch[1];
      const coordinates = coordsText.split(/\\s+|\\n/)
        .filter(line => line.trim().length > 0)
        .map(line => {
          const parts = line.trim().split(',');
          if (parts.length < 2) return null;
          
          const lon = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          
          if (isNaN(lon) || isNaN(lat)) return null;
          return [lon, lat];
        })
        .filter(coord => coord !== null);
      
      if (coordinates.length < 2) {
        console.log(`La ruta ${routeName} no tiene suficientes coordenadas válidas`);
        continue;
      }
      
      // Crear objeto GeoJSON
      const geoJSON = {
        type: "Feature",
        properties: {
          id: routeId,
          name: routeName,
          shortName: `R${routeId}`,
          color: color
        },
        geometry: {
          type: "LineString",
          coordinates: coordinates
        }
      };
      
      // Determinar zona
      const zone = determineZone(description);
      
      // Crear registro de ruta en la base de datos
      try {
        const route = await storage.createRoute({
          name: routeName + (description ? ` - ${description}` : ''),
          shortName: `R${routeId}`,
          color: color,
          frequency: schedule.frequency,
          scheduleStart: schedule.start,
          scheduleEnd: schedule.end,
          stopsCount: Math.max(3, Math.floor(coordinates.length / 30)),
          approximateTime: schedule.approximateTime,
          zone: zone,
          popular: routeCount < 5,
          geoJSON: geoJSON
        });
        
        console.log(`Ruta creada: ${route.name} (ID: ${route.id})`);
        routesMap.set(routeId.toString(), route);
        routeCount++;
        
        // Crear paradas para esta ruta
        // Terminal origen
        await storage.createStop({
          routeId: route.id,
          name: `Terminal ${description ? description.split('/')[0]?.trim() : 'Origen'}`,
          latitude: coordinates[0][1],
          longitude: coordinates[0][0],
          isTerminal: true,
          terminalType: 'first'
        });
        stopCount++;
        
        // Paradas intermedias (distribuidas a lo largo de la ruta)
        const numStops = Math.max(2, Math.min(8, Math.floor(coordinates.length / 40)));
        const step = Math.floor(coordinates.length / (numStops + 1));
        
        for (let j = 1; j <= numStops; j++) {
          const index = j * step;
          if (index < coordinates.length - 1) {
            const stopName = description ? 
              `Parada ${description.split('/')[0]?.trim()} - ${j}` : 
              `Parada ${j}`;
            
            await storage.createStop({
              routeId: route.id,
              name: stopName,
              latitude: coordinates[index][1],
              longitude: coordinates[index][0],
              isTerminal: false,
              terminalType: ''
            });
            stopCount++;
          }
        }
        
        // Terminal destino
        const lastCoord = coordinates[coordinates.length - 1];
        const destinationName = description ? 
          `Terminal ${description.split('/').pop()?.trim()}` : 
          'Terminal Destino';
        
        await storage.createStop({
          routeId: route.id,
          name: destinationName,
          latitude: lastCoord[1],
          longitude: lastCoord[0],
          isTerminal: true,
          terminalType: 'last'
        });
        stopCount++;
      
      } catch (err) {
        console.error(`Error al crear la ruta ${routeName}:`, err);
      }
    }
    
    // Segunda pasada: procesar paradas adicionales si están definidas (Point)
    for (const placemark of placemarks) {
      if (!placemark.includes('<Point>')) {
        continue;
      }
      
      // Extraer el ID de la ruta a la que pertenece la parada
      const routeIdMatch = placemark.match(/<Data name="routeId"><value>(.*?)<\/value><\/Data>/);
      if (!routeIdMatch) {
        continue;
      }
      
      const routeId = routeIdMatch[1];
      const route = routesMap.get(routeId);
      
      if (!route) {
        // No se encontró la ruta correspondiente
        continue;
      }
      
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
      
      // Determinar si es terminal
      let isTerminal = false;
      let terminalType = '';
      const sequenceMatch = placemark.match(/<Data name="sequence"><value>(.*?)<\/value><\/Data>/);
      
      if (sequenceMatch) {
        const sequence = parseInt(sequenceMatch[1]);
        isTerminal = sequence === 0 || sequence >= 10;
        terminalType = sequence === 0 ? 'first' : (sequence >= 10 ? 'last' : '');
      }
      
      // Crear parada
      try {
        await storage.createStop({
          routeId: route.id,
          name: isTerminal ? `Terminal ${stopCount}` : `Parada ${stopCount}`,
          latitude: lat.toString(),
          longitude: lon.toString(),
          isTerminal: isTerminal,
          terminalType: terminalType
        });
        
        stopCount++;
      } catch (err) {
        console.error('Error al crear parada:', err);
      }
    }
    
    console.log(`Importación completada: ${routeCount} rutas y ${stopCount} paradas creadas.`);
  } catch (error) {
    console.error('Error en la importación KML:', error);
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

// Función para generar información de horarios
function generateSchedule(peakAM: string, midday: string, peakPM: string, night: string): { 
  start: string, 
  end: string, 
  frequency: string,
  approximateTime: string 
} {
  // Convertir a números, usar valores predeterminados si no hay datos
  const peakAMMin = parseInt(peakAM) || 10;
  const middayMin = parseInt(midday) || 15;
  const peakPMMin = parseInt(peakPM) || 10;
  const nightMin = parseInt(night) || 20;
  
  // Calcular frecuencia promedio
  const avgFrequency = Math.round((peakAMMin + middayMin + peakPMMin + nightMin) / 4);
  
  // Horarios de inicio y fin
  let startTime = '05:30 AM';
  let endTime = nightMin > 15 ? '10:30 PM' : '09:00 PM';
  
  // Tiempo aproximado (estimación)
  const approximateTime = `${30 + Math.floor(Math.random() * 20)} minutos`;
  
  return {
    start: startTime,
    end: endTime,
    frequency: `${avgFrequency} minutos`,
    approximateTime
  };
}

// Ejecutar importación
async function main() {
  try {
    await importKML();
    console.log('Proceso de importación completado con éxito');
    process.exit(0);
  } catch (error) {
    console.error('Error fatal en el proceso de importación:', error);
    process.exit(1);
  }
}

main();