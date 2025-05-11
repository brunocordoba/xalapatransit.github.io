import * as fs from 'fs';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';

// Ruta al archivo KML
const KML_FILE_PATH = './attached_assets/2017-03-04_04-27.kml';

// Colores para zonas y rutas
const zoneColors = {
  'norte': '#EF4444', // red-500
  'sur': '#3B82F6',   // blue-500
  'este': '#22C55E',  // green-500
  'oeste': '#A855F7', // purple-500
  'centro': '#F97316' // orange-500
};

const routeColors = {
  'Amarillo': '#FFCC00',
  'Azul': '#0066CC',
  'Rojo': '#CC0000',
  'Verde': '#00CC33',
  'Naranja': '#FF6600',
  'Morado': '#9900CC',
  'Blanco': '#FFFFFF',
  'Negro': '#333333'
};

async function importMapatonRoutes() {
  console.log('Importando rutas de Mapaton...');
  
  try {
    // Limpiar datos existentes
    await db.delete(busStops);
    await db.delete(busRoutes);
    console.log('Datos anteriores eliminados.');
    
    // Leer el archivo KML
    const kmlContent = fs.readFileSync(KML_FILE_PATH, 'utf8');
    
    // Extraer los placemarks del archivo
    const placemarks = kmlContent.split('<Placemark>').slice(1);
    console.log(`Encontrados ${placemarks.length} placemarks en el archivo KML.`);
    
    // Importar las rutas primero
    const routes = [];
    let routeCount = 0;
    let stopCount = 0;
    
    for (const placemark of placemarks) {
      try {
        // Solo procesar placemarks que tengan LineString (rutas)
        if (!placemark.includes('<LineString>')) {
          continue;
        }
        
        // Extraer nombre de la ruta
        const nameMatch = placemark.match(/<n>(.*?)<\/n>/);
        if (!nameMatch) {
          console.log('Placemark sin nombre de ruta, omitiendo...');
          continue;
        }
        
        const routeName = nameMatch[1];
        console.log(`Procesando ruta: ${routeName}`);
        
        // Extraer descripción
        let description = '';
        const descMatch = placemark.match(/<Data name="desc"><value>(.*?)<\/value><\/Data>/);
        if (descMatch) {
          description = descMatch[1];
        }
        
        // Extraer color o notas
        let color = '#3B82F6'; // Color por defecto (azul)
        const notesMatch = placemark.match(/<Data name="notes"><value>(.*?)<\/value><\/Data>/);
        if (notesMatch && routeColors[notesMatch[1]]) {
          color = routeColors[notesMatch[1]];
        }
        
        // Extraer ID
        let routeId = 0;
        const idMatch = placemark.match(/<Data name="id"><value>(.*?)<\/value><\/Data>/);
        if (idMatch) {
          routeId = parseInt(idMatch[1]);
        } else {
          // Extraer ID del nombre
          const numMatch = routeName.match(/(\d+)/);
          if (numMatch) {
            routeId = parseInt(numMatch[1]);
          } else {
            routeId = 10000 + routeCount;
          }
        }
        
        // Determinar zona
        const zone = determineZone(description);
        
        // Si no hay color específico, usar el color de la zona
        if (!notesMatch || !routeColors[notesMatch[1]]) {
          color = zoneColors[zone];
        }
        
        // Extraer coordenadas
        const coordMatch = placemark.match(/<LineString><coordinates>([\s\S]*?)<\/coordinates><\/LineString>/);
        if (!coordMatch) {
          console.log(`No se encontraron coordenadas para la ruta ${routeName}`);
          continue;
        }
        
        const coordsText = coordMatch[1].trim();
        const coordinates = coordsText.split(/\\s+/)
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .map(line => {
            const parts = line.split(',');
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
        
        console.log(`Ruta ${routeName} tiene ${coordinates.length} puntos`);
        
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
        
        // Crear registro de ruta
        const createdRoute = await storage.createRoute({
          name: routeName + (description ? ` - ${description}` : ''),
          shortName: `R${routeId}`,
          color: color,
          frequency: '15 minutos',
          scheduleStart: '05:30 AM',
          scheduleEnd: '10:30 PM',
          stopsCount: Math.max(5, Math.floor(coordinates.length / 20)),
          approximateTime: '45 minutos',
          zone: zone,
          popular: routeCount < 5, // Las primeras 5 son populares
          geoJSON: geoJSON
        });
        
        console.log(`Ruta creada: ${createdRoute.name} (ID: ${createdRoute.id})`);
        routes.push(createdRoute);
        routeCount++;
        
        // Crear paradas para esta ruta
        // Primera parada (terminal)
        await storage.createStop({
          routeId: createdRoute.id,
          name: `Terminal ${description ? description.split('/')[0].trim() : 'Origen'}`,
          latitude: coordinates[0][1].toString(),
          longitude: coordinates[0][0].toString(),
          isTerminal: true,
          terminalType: 'first'
        });
        stopCount++;
        
        // Paradas intermedias (cada 20 puntos aproximadamente)
        const numStops = Math.max(3, Math.min(10, Math.floor(coordinates.length / 20)));
        const step = Math.floor(coordinates.length / (numStops + 1));
        
        for (let i = 1; i <= numStops; i++) {
          const index = i * step;
          if (index < coordinates.length) {
            await storage.createStop({
              routeId: createdRoute.id,
              name: `Parada ${i}`,
              latitude: coordinates[index][1].toString(),
              longitude: coordinates[index][0].toString(),
              isTerminal: false,
              terminalType: ''
            });
            stopCount++;
          }
        }
        
        // Última parada (terminal)
        const lastCoord = coordinates[coordinates.length - 1];
        await storage.createStop({
          routeId: createdRoute.id,
          name: `Terminal ${description ? description.split('/').pop().trim() : 'Destino'}`,
          latitude: lastCoord[1].toString(),
          longitude: lastCoord[0].toString(),
          isTerminal: true,
          terminalType: 'last'
        });
        stopCount++;
        
      } catch (err) {
        console.error('Error procesando placemark:', err);
      }
    }
    
    console.log(`Importación completada: ${routeCount} rutas y ${stopCount} paradas importadas.`);
  } catch (error) {
    console.error('Error en la importación:', error);
  }
}

// Función para determinar la zona basada en la descripción
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

// Ejecutar importación
async function main() {
  try {
    await importMapatonRoutes();
    process.exit(0);
  } catch (error) {
    console.error('Error fatal:', error);
    process.exit(1);
  }
}

main();