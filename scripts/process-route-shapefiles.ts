import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { spawn } from 'child_process';
import { db } from '../server/db';
import { busRoutes as routes, insertBusRouteSchema } from '../shared/schema';
import { eq } from 'drizzle-orm';

/**
 * Función para convertir un archivo shapefile a GeoJSON usando GDAL
 */
async function convertShapefileToGeoJSON(shapefilePath: string, outputPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const ogr2ogr = spawn('ogr2ogr', [
      '-f', 'GeoJSON',
      outputPath,
      shapefilePath
    ]);

    let errorOutput = '';
    
    ogr2ogr.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ogr2ogr.on('close', (code) => {
      if (code !== 0) {
        console.error(`ogr2ogr finalizó con código ${code}`);
        console.error(`Error: ${errorOutput}`);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Función para importar una ruta desde un archivo ZIP que contiene shapefiles
 */
async function importRouteFromShapefile(routeId: number, zipPath: string) {
  console.log(`Importando ruta ${routeId} desde: ${zipPath}`);
  
  try {
    if (!fs.existsSync(zipPath)) {
      console.error(`El archivo ${zipPath} no existe.`);
      return;
    }
    
    // Crear directorio temporal para extraer el ZIP
    const tempDir = path.join('./tmp', `route_${routeId}_${Date.now()}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Extraer el ZIP
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tempDir, true);
    
    // Buscar archivos SHP
    const shpFiles = findFiles(tempDir, '.shp');
    
    if (shpFiles.length === 0) {
      console.error(`No se encontraron archivos SHP en ${zipPath}`);
      
      // Intentar con archivos KML
      const kmlFiles = findFiles(tempDir, '.kml');
      
      if (kmlFiles.length > 0) {
        for (const kmlFile of kmlFiles) {
          await processKML(routeId, kmlFile);
        }
      } else {
        // Como último recurso, buscar GeoJSON
        const geojsonFiles = findFiles(tempDir, '.geojson') || findFiles(tempDir, '.json');
        
        if (geojsonFiles.length > 0) {
          for (const geojsonFile of geojsonFiles) {
            await processGeoJSON(routeId, geojsonFile);
          }
        } else {
          console.error(`No se encontraron archivos SHP, KML o GeoJSON en ${zipPath}`);
        }
      }
      
      return;
    }
    
    // Convertir SHP a GeoJSON
    const geojsonPath = path.join(tempDir, `route_${routeId}.geojson`);
    
    try {
      const success = await convertShapefileToGeoJSON(shpFiles[0], geojsonPath);
      
      if (!success) {
        console.error(`Error al convertir el Shapefile a GeoJSON: ${shpFiles[0]}`);
        return;
      }
      
      // Procesar el GeoJSON
      await processGeoJSON(routeId, geojsonPath);
      
    } catch (error) {
      console.error(`Error procesando Shapefile: ${error}`);
    } finally {
      // Limpiar directorio temporal
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        console.error(`Error al limpiar directorio temporal: ${e}`);
      }
    }
    
  } catch (error) {
    console.error(`Error importando ruta ${routeId}:`, error);
  }
}

/**
 * Procesa un archivo KML para extraer coordenadas
 */
async function processKML(routeId: number, kmlPath: string) {
  console.log(`Procesando KML: ${kmlPath}`);
  
  try {
    const kmlContent = fs.readFileSync(kmlPath, 'utf8');
    
    // Extraer coordenadas del KML
    const coordsMatch = kmlContent.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
    if (!coordsMatch || !coordsMatch[1]) {
      console.error('No se encontraron coordenadas en el KML');
      return;
    }
    
    const coordsStr = coordsMatch[1].trim();
    const coordinates = parseCoordinatesString(coordsStr);
    
    if (coordinates.length === 0) {
      console.error('No se pudieron extraer coordenadas válidas del KML');
      return;
    }
    
    // Crear la ruta en la base de datos
    await createRoute(routeId, coordinates);
    
  } catch (error) {
    console.error(`Error procesando KML ${kmlPath}:`, error);
  }
}

/**
 * Procesa un archivo GeoJSON para extraer coordenadas
 */
async function processGeoJSON(routeId: number, geojsonPath: string) {
  console.log(`Procesando GeoJSON: ${geojsonPath}`);
  
  try {
    const geojsonStr = fs.readFileSync(geojsonPath, 'utf8');
    const geojson = JSON.parse(geojsonStr);
    
    if (!geojson || !geojson.features || !geojson.features.length) {
      console.error('El archivo GeoJSON no tiene la estructura esperada.');
      return;
    }
    
    // Tomamos la primera feature
    const feature = geojson.features[0];
    
    let coordinates: [number, number][] = [];
    
    // Extraer coordenadas según el tipo de geometría
    if (feature.geometry.type === 'LineString') {
      coordinates = feature.geometry.coordinates;
    } 
    else if (feature.geometry.type === 'MultiLineString') {
      // Tomar la primera línea para MultiLineString
      coordinates = feature.geometry.coordinates[0];
    }
    else if (feature.geometry.type === 'Point') {
      console.error('La geometría es un punto, no una línea.');
      return;
    }
    else {
      console.error(`Tipo de geometría no soportado: ${feature.geometry.type}`);
      return;
    }
    
    if (!coordinates || coordinates.length === 0) {
      console.error('No se encontraron coordenadas en el GeoJSON');
      return;
    }
    
    // Crear la ruta en la base de datos
    await createRoute(routeId, coordinates);
    
  } catch (error) {
    console.error(`Error procesando GeoJSON ${geojsonPath}:`, error);
  }
}

/**
 * Parsea un string de coordenadas en formato KML a array de coordenadas
 */
function parseCoordinatesString(coordsStr: string): [number, number][] {
  const coordinates: [number, number][] = [];
  
  const pairs = coordsStr.split(/\s+/);
  for (const pair of pairs) {
    const parts = pair.split(',');
    if (parts.length >= 2) {
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      
      if (!isNaN(lng) && !isNaN(lat)) {
        coordinates.push([lng, lat]);
      }
    }
  }
  
  return coordinates;
}

/**
 * Función para crear una ruta en la base de datos
 */
async function createRoute(routeId: number, coordinates: [number, number][]) {
  if (!coordinates || coordinates.length === 0) {
    console.error('No hay coordenadas para crear la ruta');
    return null;
  }
  
  console.log(`Creando ruta ${routeId} con ${coordinates.length} puntos`);
  
  // Determinar la zona basado en el ID de la ruta
  const zone = determineZone(routeId);
  
  // Datos para la inserción de la ruta
  const routeData = {
    name: `Ruta ${routeId}`,
    shortName: `R${routeId}`,
    color: getRandomColor(),
    frequency: getRandomFrequency(),
    scheduleStart: '05:00',
    scheduleEnd: '22:00',
    stopsCount: 0, // Sin paradas
    approximateTime: approximateTimeFromPoints(coordinates.length),
    zone,
    geoJSON: {
      type: "Feature",
      properties: {
        id: routeId,
        name: `Ruta ${routeId}`,
        shortName: `R${routeId}`,
        color: getRandomColor()
      },
      geometry: {
        type: "LineString",
        coordinates
      }
    },
  };
  
  try {
    // Validar los datos con el esquema de inserción
    const parsedData = insertBusRouteSchema.parse(routeData);
    
    // Verificar si la ruta ya existe
    const existingRoutes = await db.select()
      .from(routes)
      .where(eq(routes.name, `Ruta ${routeId}`));
    
    if (existingRoutes.length > 0) {
      // Si la ruta existe, actualizar sus coordenadas
      console.log(`Actualizando Ruta ${routeId} existente (ID: ${existingRoutes[0].id})`);
      
      const [updatedRoute] = await db.update(routes)
        .set({
          geoJSON: {
            type: "Feature",
            properties: {
              id: routeId,
              name: `Ruta ${routeId}`,
              shortName: `R${routeId}`,
              color: existingRoutes[0].color
            },
            geometry: {
              type: "LineString",
              coordinates
            }
          }
        })
        .where(eq(routes.id, existingRoutes[0].id))
        .returning();
      
      console.log(`✅ Ruta actualizada: ${routeData.name} (ID: ${updatedRoute.id}) con ${coordinates.length} puntos`);
      return updatedRoute;
    }
    
    // Insertar la ruta en la base de datos
    const [insertedRoute] = await db.insert(routes).values(parsedData).returning();
    
    console.log(`✅ Ruta creada: ${routeData.name} (ID: ${insertedRoute.id}) con ${coordinates.length} puntos`);
    
    return insertedRoute;
  } catch (error) {
    console.error(`Error creando/actualizando ruta ${routeId}:`, error);
    return null;
  }
}

/**
 * Función para determinar la zona basado en el ID de la ruta
 */
function determineZone(routeId: number): string {
  if (routeId <= 20) return 'Centro';
  if (routeId <= 40) return 'Norte';
  if (routeId <= 60) return 'Sur';
  if (routeId <= 80) return 'Este';
  return 'Oeste';
}

/**
 * Función para generar un color aleatorio para la ruta
 */
function getRandomColor(): string {
  const colors = [
    '#FF5733', '#33FF57', '#3357FF', '#FF33F5', '#F5FF33',
    '#33FFF5', '#F533FF', '#FF3333', '#33FF33', '#3333FF',
    '#FFAA33', '#33FFAA', '#AA33FF', '#FF33AA', '#AAFF33',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Función para generar un tiempo aproximado basado en la cantidad de puntos
 */
function approximateTimeFromPoints(points: number): string {
  // Asumimos que cada punto representa aproximadamente 30 segundos de viaje
  const totalMinutes = Math.max(10, Math.round(points * 0.5));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }
  return `${minutes}min`;
}

/**
 * Función para generar una frecuencia aleatoria de servicio
 */
function getRandomFrequency(): string {
  const frequencies = [
    '15-20 min', '20-30 min', '30-40 min', '10-15 min', '20-25 min'
  ];
  return frequencies[Math.floor(Math.random() * frequencies.length)];
}

/**
 * Función para buscar archivos por extensión en un directorio
 */
function findFiles(dir: string, extension: string): string[] {
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    
    const files = fs.readdirSync(dir);
    return files
      .filter(file => file.toLowerCase().endsWith(extension))
      .map(file => path.join(dir, file));
  } catch (error) {
    console.error(`Error buscando archivos en ${dir}:`, error);
    return [];
  }
}

/**
 * Función principal para procesar un rango de rutas
 */
async function processRouteRange(startId: number, endId: number) {
  console.log(`Procesando rutas desde ${startId} hasta ${endId}`);
  
  const baseDir = './tmp/mapaton-extract/shapefiles-mapton-ciudadano';
  
  for (let routeId = startId; routeId <= endId; routeId++) {
    // Determinar el directorio (circuito o ruta)
    let routeDir = '';
    
    if (fs.existsSync(path.join(baseDir, `${routeId}_circuito`))) {
      routeDir = `${routeId}_circuito`;
    } else if (fs.existsSync(path.join(baseDir, `${routeId}_ruta`))) {
      routeDir = `${routeId}_ruta`;
    } else {
      console.log(`No se encontró directorio para la ruta ${routeId}`);
      continue;
    }
    
    // Verificar si existe archivo ZIP de ruta
    const routeZip = path.join(baseDir, routeDir, 'route.zip');
    
    if (fs.existsSync(routeZip)) {
      await importRouteFromShapefile(routeId, routeZip);
    } else {
      console.log(`No se encontró archivo ZIP para la ruta ${routeId}`);
    }
  }
  
  console.log(`Procesamiento de rutas ${startId}-${endId} completado.`);
}

/**
 * Función principal
 */
async function main() {
  if (process.argv.length < 4) {
    console.error('Uso: npx tsx scripts/process-route-shapefiles.ts <id_inicial> <id_final>');
    process.exit(1);
  }
  
  const startId = parseInt(process.argv[2], 10);
  const endId = parseInt(process.argv[3], 10);
  
  if (isNaN(startId) || isNaN(endId)) {
    console.error('Los IDs deben ser números válidos');
    process.exit(1);
  }
  
  await processRouteRange(startId, endId);
  console.log('Procesamiento completado.');
}

main().catch(console.error);