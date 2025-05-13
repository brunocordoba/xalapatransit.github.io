import * as fs from 'fs';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';
import { BusRoute } from '../shared/schema';

// Ruta al archivo KML
const KML_FILE_PATH = './attached_assets/2017-03-04_04-27.kml';

// Colores para zonas
const zoneColors: { [key: string]: string } = {
  'norte': '#EF4444', // red-500
  'sur': '#3B82F6',   // blue-500
  'este': '#22C55E',  // green-500
  'oeste': '#A855F7', // purple-500
  'centro': '#F97316' // orange-500
};

// Colores para rutas específicas basados en Mapaton.org
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

// Función para procesar un placemark de KML y extraer datos de la ruta
async function processKmlFile(filePath: string) {
  console.log(`Procesando archivo KML: ${filePath}`);
  
  try {
    // Leer el archivo KML
    const kmlContent = fs.readFileSync(filePath, 'utf8');
    
    // Dividir el archivo en placemarks (cada uno es una ruta)
    const placemarks = kmlContent.split('<Placemark>').slice(1);
    console.log(`Encontrados ${placemarks.length} placemarks (rutas potenciales)`);
    
    // Limpiar la base de datos antes de la importación
    await db.delete(busStops);
    await db.delete(busRoutes);
    console.log('Base de datos limpia para la importación');
    
    let routeCount = 0;
    let stopCount = 0;
    
    // Procesar cada placemark
    for (const placemark of placemarks) {
      try {
        // Extraer nombre de la ruta
        const nameMatch = placemark.match(/<n>(.*?)<\/n>/);
        if (!nameMatch) {
          console.log('Placemark sin nombre de ruta, omitiendo...');
          continue;
        }
        
        // Solo procesar placemarks que tengan LineString (rutas)
        if (!placemark.includes('<LineString>')) {
          console.log(`Placemark ${nameMatch[1]} no tiene LineString, omitiendo...`);
          continue;
        }
        
        const routeName = nameMatch[1];
        
        // Extraer descripción, notas y datos de frecuencia
        let description = '';
        let notes = '';
        let peakAM = '';
        let midday = '';
        let peakPM = '';
        let night = '';
        let routeId = 0;
        
        const descMatch = placemark.match(/<Data name="desc"><value>(.*?)<\/value><\/Data>/);
        if (descMatch) {
          description = descMatch[1];
        }
        
        const notesMatch = placemark.match(/<Data name="notes"><value>(.*?)<\/value><\/Data>/);
        if (notesMatch) {
          notes = notesMatch[1];
        }
        
        const peakAMMatch = placemark.match(/<Data name="peak_am"><value>(.*?)<\/value><\/Data>/);
        if (peakAMMatch) {
          peakAM = peakAMMatch[1];
        }
        
        const middayMatch = placemark.match(/<Data name="midday"><value>(.*?)<\/value><\/Data>/);
        if (middayMatch) {
          midday = middayMatch[1];
        }
        
        const peakPMMatch = placemark.match(/<Data name="peak_pm"><value>(.*?)<\/value><\/Data>/);
        if (peakPMMatch) {
          peakPM = peakPMMatch[1];
        }
        
        const nightMatch = placemark.match(/<Data name="night"><value>(.*?)<\/value><\/Data>/);
        if (nightMatch) {
          night = nightMatch[1];
        }
        
        const idMatch = placemark.match(/<Data name="id"><value>(.*?)<\/value><\/Data>/);
        if (idMatch) {
          routeId = parseInt(idMatch[1]);
        } else {
          routeId = extractRouteId(routeName);
        }
        
        // Determinar color de la ruta
        let color = '#3B82F6'; // Color por defecto (azul)
        if (notes && routeColors[notes]) {
          color = routeColors[notes];
        } else {
          // Usar color basado en la zona si no hay color específico
          const zone = determineZone(description);
          color = zoneColors[zone];
        }
        
        // Extraer coordenadas
        const coordMatch = placemark.match(/<LineString><coordinates>([\s\S]*?)<\/coordinates><\/LineString>/);
        if (!coordMatch) {
          console.log(`No se encontraron coordenadas para la ruta ${routeName}`);
          continue;
        }
        
        // Procesar coordenadas (formato: longitud,latitud,altitud)
        const coordsText = coordMatch[1].trim();
        
        // Dividir por saltos de línea
        const lines = coordsText.split(/\n/).map(line => line.trim()).filter(line => line.length > 0);
        
        console.log(`Ruta ${routeName}: Encontradas ${lines.length} líneas de coordenadas`);
        
        const coordinates = lines
          .map(line => {
            const parts = line.split(',');
            if (parts.length < 2) return null;
            
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            
            if (isNaN(lon) || isNaN(lat)) return null;
            return [lon, lat] as [number, number];
          })
          .filter((coord): coord is [number, number] => coord !== null);
          
        console.log(`Ruta ${routeName}: ${coordinates.length} coordenadas válidas procesadas`);
        
        if (coordinates.length < 2) {
          console.log(`La ruta ${routeName} no tiene suficientes coordenadas válidas`);
          continue;
        }
        
        // Generar horarios y frecuencia basados en los datos del KML
        const schedule = generateSchedule(peakAM, midday, peakPM, night);
        
        // Determinar zona de la ruta
        const zone = determineZone(description);
        
        // Crear objeto GeoJSON con el formato exacto de Mapaton.org
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
        
        console.log(`Procesando ruta: ${routeName} - ${description} (${coordinates.length} puntos)`);
        
        // Crear registro de la ruta en la base de datos
        const route = await storage.createRoute({
          name: routeName + (description ? ` - ${description}` : ''),
          shortName: `R${routeId}`,
          color: color,
          frequency: schedule.frequency,
          scheduleStart: schedule.start,
          scheduleEnd: schedule.end,
          stopsCount: Math.max(5, Math.min(15, Math.floor(coordinates.length / 40))),
          approximateTime: `${Math.max(30, Math.min(90, Math.floor(coordinates.length / 10)))} minutos`,
          zone: zone,
          popular: routeCount < 15, // Las primeras 15 son populares
          geoJSON: geoJSON
        });
        
        console.log(`Ruta creada: ${route.name} (ID: ${route.id})`);
        routeCount++;
        
        // Crear paradas de la ruta (origen, puntos intermedios, destino)
        // Terminal origen
        await storage.createStop({
          routeId: route.id,
          name: `Terminal ${description ? description.split('/')[0]?.trim() : 'Origen'}`,
          latitude: coordinates[0][1].toString(),
          longitude: coordinates[0][0].toString(),
          isTerminal: true,
          terminalType: 'first'
        });
        stopCount++;
        
        // Paradas intermedias (cada n puntos, dependiendo del tamaño de la ruta)
        const numStops = Math.max(3, Math.min(15, Math.floor(coordinates.length / 40)));
        const step = Math.floor(coordinates.length / (numStops + 1));
        
        for (let i = 1; i <= numStops; i++) {
          const index = i * step;
          if (index < coordinates.length - 1) {
            await storage.createStop({
              routeId: route.id,
              name: `Parada ${i}`,
              latitude: coordinates[index][1].toString(),
              longitude: coordinates[index][0].toString(),
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
          name: `Terminal ${description ? description.split('/').pop()?.trim() : 'Destino'}`,
          latitude: lastCoord[1].toString(),
          longitude: lastCoord[0].toString(),
          isTerminal: true,
          terminalType: 'last'
        });
        stopCount++;
        
      } catch (error) {
        console.error('Error procesando placemark:', error);
      }
    }
    
    console.log(`Importación completada: ${routeCount} rutas y ${stopCount} paradas importadas`);
    return { routeCount, stopCount };
    
  } catch (error) {
    console.error('Error procesando archivo KML:', error);
    throw error;
  }
}

// Extraer ID de ruta del nombre (ejemplo: "Ruta 10001" -> 10001)
function extractRouteId(name: string): number {
  const match = name.match(/(\d+)/);
  if (match) {
    return parseInt(match[1]);
  }
  return Math.floor(Math.random() * 90000) + 10000; // ID aleatorio entre 10000 y 99999
}

// Determinar zona basada en la descripción de la ruta
function determineZone(desc: string): string {
  if (!desc) return 'centro';
  
  const descLower = desc.toLowerCase();
  
  if (descLower.includes('camacho') || descLower.includes('animas') || descLower.includes('lomas')) {
    return 'norte';
  } else if (descLower.includes('trancas') || descLower.includes('2000') || descLower.includes('arco sur')) {
    return 'sur';
  } else if (descLower.includes('universidad') || descLower.includes('uv') || descLower.includes('rebsamen')) {
    return 'este';
  } else if (descLower.includes('centro')) {
    return 'centro';
  } else if (descLower.includes('coapexpan') || descLower.includes('sumidero')) {
    return 'oeste';
  }
  
  return 'centro';
}

// Generar horarios y frecuencia basados en los datos del KML
function generateSchedule(peakAM: string, midday: string, peakPM: string, night: string): { 
  frequency: string, 
  start: string, 
  end: string 
} {
  // Horario de inicio y fin estándar
  let start = '05:30 AM';
  let end = '10:30 PM';
  
  // Calcular frecuencia en minutos basada en los valores del KML
  let frequency = '15 minutos';
  try {
    const peakAMValue = parseInt(peakAM) || 15;
    const middayValue = parseInt(midday) || 20;
    const peakPMValue = parseInt(peakPM) || 15;
    const nightValue = parseInt(night) || 25;
    
    // Promediar valores para obtener frecuencia general
    const avgFrequency = Math.round((peakAMValue + middayValue + peakPMValue + nightValue) / 4);
    frequency = `${avgFrequency} minutos`;
    
    // Ajustar horarios según los valores
    if (peakAMValue > 30 || nightValue > 40) {
      start = '06:00 AM';
      end = '09:00 PM';
    } else if (peakAMValue < 10 && nightValue < 20) {
      start = '05:00 AM';
      end = '11:00 PM';
    }
  } catch (e) {
    console.warn('Error al calcular frecuencia, usando valores por defecto');
  }
  
  return { frequency, start, end };
}

// Función principal para importar todas las rutas
async function importAllRoutes() {
  console.log('Iniciando importación de todas las rutas desde el archivo KML...');
  
  try {
    // Procesar el archivo KML
    const result = await processKmlFile(KML_FILE_PATH);
    
    console.log(`Importación exitosa: ${result.routeCount} rutas y ${result.stopCount} paradas`);
    return result;
  } catch (error) {
    console.error('Error en la importación:', error);
    throw error;
  }
}

// Ejecutar la importación
async function main() {
  try {
    await importAllRoutes();
    console.log('Proceso de importación completado con éxito');
    process.exit(0);
  } catch (error) {
    console.error('Error fatal en el proceso de importación:', error);
    process.exit(1);
  }
}

main();