import * as fs from 'fs';
import * as path from 'path';
import * as shapefile from 'shapefile';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';

// Ruta a la carpeta que contiene los shapefiles
const SHAPEFILES_DIR = './tmp/shapefiles/shapefiles-mapton-ciudadano';

// Colores para zonas
const zoneColors: { [key: string]: string } = {
  'norte': '#EF4444', // red-500
  'sur': '#3B82F6',   // blue-500
  'este': '#22C55E',  // green-500
  'oeste': '#A855F7', // purple-500
  'centro': '#F97316' // orange-500
};

// Función principal para importar las rutas desde los shapefiles
async function importRoutes() {
  console.log('Iniciando importación de rutas desde shapefiles...');
  
  try {
    // Limpiar la base de datos antes de importar
    await db.delete(busStops);
    await db.delete(busRoutes);
    console.log('Base de datos limpia para la importación');
    
    // Leer todas las carpetas de rutas
    const routeDirs = fs.readdirSync(SHAPEFILES_DIR)
      .filter(dir => dir.includes('_circuito') && !dir.startsWith('.'))
      .filter(dir => !fs.lstatSync(path.join(SHAPEFILES_DIR, dir)).isFile());
    
    console.log(`Encontradas ${routeDirs.length} carpetas de rutas`);
    
    let routeCount = 0;
    let stopCount = 0;
    
    // Procesar cada ruta
    for (const routeDir of routeDirs) {
      try {
        // Extraer el número de ruta del nombre de la carpeta
        const routeNumber = routeDir.split('_')[0];
        const routeId = parseInt(routeNumber);
        
        if (isNaN(routeId)) {
          console.log(`No se pudo extraer ID de ruta válido para ${routeDir}, omitiendo...`);
          continue;
        }
        
        console.log(`Procesando ruta ${routeId} (${routeDir})...`);
        
        const routePath = path.join(SHAPEFILES_DIR, routeDir);
        
        // Determinar si la ruta tiene dirección de ida/vuelta o es una sola
        let directions: string[] = [];
        if (fs.existsSync(path.join(routePath, 'ida'))) {
          directions.push('ida');
        }
        if (fs.existsSync(path.join(routePath, 'vuelta'))) {
          directions.push('vuelta');
        }
        if (directions.length === 0 && fs.existsSync(path.join(routePath, 'route.zip'))) {
          // La ruta no tiene subdirecciones
          directions.push('');
        }
        
        for (const direction of directions) {
          // Construir la ruta al archivo zip de la ruta
          let routeZipPath: string;
          if (direction) {
            routeZipPath = path.join(routePath, direction, 'route.zip');
          } else {
            routeZipPath = path.join(routePath, 'route.zip');
          }
          
          // Verificar que el archivo de ruta existe
          if (!fs.existsSync(routeZipPath)) {
            console.log(`No se encontró archivo de ruta para ${routeDir}/${direction}, omitiendo...`);
            continue;
          }
          
          // Crear una carpeta temporal para extraer el shapefile
          const tempDir = path.join('./tmp', `route_${routeId}_${direction}`);
          
          // Extraer el shapefile
          try {
            if (!fs.existsSync(tempDir)) {
              fs.mkdirSync(tempDir, { recursive: true });
            }
            
            console.log(`Extrayendo shapefile de ruta desde ${routeZipPath}...`);
            const unzipCommand = require('child_process').execSync(`unzip -o "${routeZipPath}" -d "${tempDir}"`);
            
            // Buscar archivos .shp en la carpeta extraída
            const shpFiles = fs.readdirSync(tempDir).filter(file => file.endsWith('.shp'));
            
            if (shpFiles.length === 0) {
              console.log(`No se encontraron archivos .shp en ${tempDir}, omitiendo...`);
              continue;
            }
            
            // Leer el primer archivo .shp
            const shpFile = path.join(tempDir, shpFiles[0]);
            console.log(`Leyendo shapefile: ${shpFile}`);
            
            // Leer el shapefile con la biblioteca
            const source = await shapefile.open(shpFile);
            let feature: any;
            let coordinates: [number, number][] = [];
            
            // Leer todas las features del shapefile (generalmente solo hay una para rutas)
            while ((feature = await source.read()) !== null) {
              if (feature.geometry.type === 'LineString') {
                coordinates = feature.geometry.coordinates;
                break;
              } else if (feature.geometry.type === 'MultiLineString') {
                // Concatenar todos los segmentos de línea
                coordinates = feature.geometry.coordinates.flat();
                break;
              }
            }
            
            if (coordinates.length < 2) {
              console.log(`La ruta ${routeId} no tiene suficientes coordenadas válidas, omitiendo...`);
              continue;
            }
            
            // Generar un nombre descriptivo para la ruta
            const routeName = `Ruta ${routeId}${direction ? (direction === 'ida' ? ' (Ida)' : ' (Vuelta)') : ''}`;
            const zoneName = determineZone({ route_id: routeId });
            const shortName = generateShortName(routeName);
            
            // Determinar el color de la ruta
            const color = zoneColors[zoneName] || '#3B82F6';
            
            // Crear objeto GeoJSON
            const geoJSON = {
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
            
            // Aproximar tiempo y frecuencia basados en la longitud de la ruta
            const approxTime = generateApproximateTime(coordinates.length);
            const frequency = generateFrequency();
            
            // Crear el registro de la ruta en la base de datos
            const route = await storage.createRoute({
              name: routeName,
              shortName: shortName,
              color: color,
              frequency: frequency,
              scheduleStart: '05:30 AM',
              scheduleEnd: '10:30 PM',
              stopsCount: Math.max(5, Math.min(15, Math.floor(coordinates.length / 40))),
              approximateTime: approxTime,
              zone: zoneName,
              popular: routeCount < 15, // Las primeras 15 rutas son populares
              geoJSON: geoJSON
            });
            
            console.log(`Ruta creada: ${route.name} (ID: ${route.id}, ${coordinates.length} puntos)`);
            routeCount++;
            
            // Ahora procesar las paradas si existen
            let stopsZipPath: string | null = null;
            if (direction) {
              const potentialStopsPath = path.join(routePath, direction, 'stops.zip');
              if (fs.existsSync(potentialStopsPath)) {
                stopsZipPath = potentialStopsPath;
              }
            }
            
            // Si encontramos un archivo de paradas, procesarlo
            if (stopsZipPath) {
              const stopsDir = path.join('./tmp', `stops_${routeId}_${direction}`);
              if (!fs.existsSync(stopsDir)) {
                fs.mkdirSync(stopsDir, { recursive: true });
              }
              
              console.log(`Extrayendo shapefile de paradas desde ${stopsZipPath}...`);
              require('child_process').execSync(`unzip -o "${stopsZipPath}" -d "${stopsDir}"`);
              
              // Buscar archivos .shp en la carpeta extraída
              const stopsShpFiles = fs.readdirSync(stopsDir).filter(file => file.endsWith('.shp'));
              
              if (stopsShpFiles.length > 0) {
                // Leer el primer archivo .shp
                const stopsShpFile = path.join(stopsDir, stopsShpFiles[0]);
                console.log(`Leyendo shapefile de paradas: ${stopsShpFile}`);
                
                // Leer el shapefile con la biblioteca
                const stopsSource = await shapefile.open(stopsShpFile);
                let stopFeature: any;
                let stopIndex = 0;
                
                // Terminal origen (primera parada)
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
                
                // Leer todas las paradas del shapefile
                while ((stopFeature = await stopsSource.read()) !== null) {
                  if (stopFeature.geometry.type === 'Point') {
                    const stopCoord = stopFeature.geometry.coordinates;
                    
                    // Extraer propiedades para determinar el nombre
                    const stopProps = stopFeature.properties || {};
                    const stopName = stopProps.name || `Parada ${++stopIndex}`;
                    const isTerminal = stopIndex === 1 || stopIndex === stopCount - 1;
                    
                    await storage.createStop({
                      routeId: route.id,
                      name: stopName,
                      latitude: stopCoord[1].toString(),
                      longitude: stopCoord[0].toString(),
                      isTerminal: isTerminal,
                      terminalType: ''
                    });
                    stopCount++;
                  }
                }
                
                // Terminal destino (última parada)
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
                
                console.log(`Paradas creadas para ruta ${routeId}: ${stopCount}`);
              } else {
                // Si no hay shapefile de paradas, generar paradas automáticamente
                await generateAutomaticStops(route.id, coordinates);
                stopCount += Math.ceil(coordinates.length / 40) + 2; // +2 por las terminales
              }
            } else {
              // Si no hay archivo de paradas, generar paradas automáticamente
              await generateAutomaticStops(route.id, coordinates);
              stopCount += Math.ceil(coordinates.length / 40) + 2; // +2 por las terminales
            }
          } catch (error) {
            console.error(`Error procesando shapefile de ruta ${routeId}:`, error);
          }
        }
      } catch (error) {
        console.error(`Error procesando ruta ${routeDir}:`, error);
      }
    }
    
    console.log(`Importación completada: ${routeCount} rutas y ${stopCount} paradas importadas`);
    return { routeCount, stopCount };
  } catch (error) {
    console.error('Error en la importación:', error);
    throw error;
  }
}

// Función para importar paradas individuales si hay shapefile de paradas
async function importStops() {
  // Esta función está incorporada en importRoutes
}

// Función para generar paradas automáticas a lo largo de la ruta
async function generateAutomaticStops(routeId: number, coordinates: [number, number][]) {
  try {
    // Cantidad de paradas a generar (sin contar terminales)
    const numStops = Math.max(3, Math.min(15, Math.floor(coordinates.length / 40)));
    const step = Math.floor(coordinates.length / (numStops + 1));
    
    // Terminal origen (primera parada)
    await storage.createStop({
      routeId: routeId,
      name: `Terminal Origen`,
      latitude: coordinates[0][1].toString(),
      longitude: coordinates[0][0].toString(),
      isTerminal: true,
      terminalType: 'first'
    });
    
    // Paradas intermedias
    for (let i = 1; i <= numStops; i++) {
      const index = i * step;
      if (index < coordinates.length - 1) {
        await storage.createStop({
          routeId: routeId,
          name: `Parada ${i}`,
          latitude: coordinates[index][1].toString(),
          longitude: coordinates[index][0].toString(),
          isTerminal: false,
          terminalType: ''
        });
      }
    }
    
    // Terminal destino (última parada)
    await storage.createStop({
      routeId: routeId,
      name: `Terminal Destino`,
      latitude: coordinates[coordinates.length - 1][1].toString(),
      longitude: coordinates[coordinates.length - 1][0].toString(),
      isTerminal: true,
      terminalType: 'last'
    });
    
    console.log(`Generadas ${numStops + 2} paradas automáticas para ruta ${routeId}`);
  } catch (error) {
    console.error(`Error generando paradas automáticas para ruta ${routeId}:`, error);
  }
}

// Función para determinar la zona basándose en el ID de la ruta
function determineZone(properties: any): string {
  // Determinar zona basada en el ID de ruta
  const routeId = properties.route_id || 0;
  
  // Asignar zonas según rangos de ID
  if (routeId < 20) return 'centro';
  if (routeId < 40) return 'norte';
  if (routeId < 60) return 'sur';
  if (routeId < 80) return 'este';
  return 'oeste';
}

// Función para generar nombre corto para la ruta
function generateShortName(routeName: string): string {
  const match = routeName.match(/Ruta (\d+)/);
  if (match) {
    return `R${match[1]}`;
  }
  return routeName.substring(0, 5);
}

// Función para aproximar el tiempo de viaje
function generateApproximateTime(coordinatesLength: number): string {
  // Aproximar tiempo basado en la cantidad de puntos
  const minTime = 30; // mínimo 30 minutos
  const maxTime = 90; // máximo 90 minutos
  
  // Calcular tiempo proporcional a la cantidad de puntos
  const time = Math.max(minTime, Math.min(maxTime, Math.floor(coordinatesLength / 10)));
  return `${time} minutos`;
}

// Función para generar frecuencia de paso
function generateFrequency(): string {
  // Frecuencias entre 10 y 30 minutos
  const frequencies = [10, 12, 15, 20, 25, 30];
  const randomIndex = Math.floor(Math.random() * frequencies.length);
  return `${frequencies[randomIndex]} minutos`;
}

// Función para determinar a qué ruta pertenece una parada
function determineRouteForStop(stopProperties: any, routes: any[]): number | null {
  // Si hay routeId en las propiedades, usarlo
  if (stopProperties.route_id) {
    return parseInt(stopProperties.route_id);
  }
  
  // Otra opción: usar el ID más cercano
  return null;
}

// Ejecutar la importación
async function main() {
  try {
    await importRoutes();
    console.log('Proceso de importación completado con éxito');
    process.exit(0);
  } catch (error) {
    console.error('Error fatal en el proceso de importación:', error);
    process.exit(1);
  }
}

main();