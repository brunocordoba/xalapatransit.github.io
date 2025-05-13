// Script para importar una ruta alternativa específica
// Uso: node scripts/import-ruta-alternativa.js <numero_ruta> <numero_alternativa>

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { db } = require('../server/db');
const { storage } = require('../server/storage');

// Parámetros de la línea de comandos
const routeId = parseInt(process.argv[2], 10);
const alternateNum = parseInt(process.argv[3], 10);

if (isNaN(routeId) || isNaN(alternateNum) || alternateNum < 1 || alternateNum > 2) {
  console.error('Uso: node scripts/import-ruta-alternativa.js <numero_ruta> <numero_alternativa>');
  console.error('El número de alternativa debe ser 1 o 2');
  process.exit(1);
}

// Constantes y directorios
const MAPATON_DIR = './tmp/mapaton-extract/shapefiles-mapton-ciudadano';
const PROCESSED_DIR = './tmp/processed';

// Crear directorios si no existen
if (!fs.existsSync(PROCESSED_DIR)) {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
}

// Colores para zonas
const zoneColors = {
  'norte': '#EF4444', // red-500
  'sur': '#3B82F6',   // blue-500
  'este': '#22C55E',  // green-500
  'oeste': '#A855F7', // purple-500
  'centro': '#F97316' // orange-500
};

async function importarRutaAlternativa() {
  console.log(`Importando ruta ${routeId} (alternativa ${alternateNum})...`);
  
  try {
    // 1. Verificar que existan los directorios
    const routeDir = path.join(MAPATON_DIR, `${routeId}_circuito`);
    const routeSubDir = path.join(routeDir, `ruta_${alternateNum}`);
    
    if (!fs.existsSync(routeDir)) {
      console.error(`Error: No existe el directorio para la ruta ${routeId}`);
      process.exit(1);
    }
    
    if (!fs.existsSync(routeSubDir)) {
      console.error(`Error: No existe el subdirectorio ruta_${alternateNum} para la ruta ${routeId}`);
      process.exit(1);
    }
    
    // 2. Verificar que exista el archivo route.zip
    const routeZipPath = path.join(routeSubDir, 'route.zip');
    if (!fs.existsSync(routeZipPath)) {
      console.error(`Error: No existe el archivo route.zip para la ruta ${routeId} (alternativa ${alternateNum})`);
      process.exit(1);
    }
    
    // 3. Preparar directorios de procesamiento
    const tempDir = path.join(PROCESSED_DIR, `route_${routeId}_alt${alternateNum}`);
    const routeShpDir = path.join(tempDir, 'route');
    
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(routeShpDir, { recursive: true });
    
    // 4. Extraer el archivo route.zip
    console.log('Extrayendo archivo route.zip...');
    execSync(`unzip -o ${routeZipPath} -d ${routeShpDir}`);
    
    // 5. Buscar archivo .shp para la ruta
    const routeShpFiles = fs.readdirSync(routeShpDir)
      .filter(file => file.endsWith('.shp'))
      .map(file => path.join(routeShpDir, file));
      
    if (routeShpFiles.length === 0) {
      console.error(`Error: No se encontraron archivos .shp en ${routeShpDir}`);
      process.exit(1);
    }
    
    // 6. Convertir shapefile a GeoJSON
    const routeShpFile = routeShpFiles[0];
    const routeGeoJsonFile = path.join(tempDir, 'route.geojson');
    
    console.log('Convirtiendo shapefile a GeoJSON...');
    execSync(`ogr2ogr -f GeoJSON ${routeGeoJsonFile} ${routeShpFile}`);
    
    if (!fs.existsSync(routeGeoJsonFile)) {
      console.error(`Error al convertir shapefile a GeoJSON: ${routeShpFile}`);
      process.exit(1);
    }
    
    // 7. Leer archivo GeoJSON y extraer datos
    console.log('Leyendo GeoJSON...');
    const routeGeoJson = JSON.parse(fs.readFileSync(routeGeoJsonFile, 'utf8'));
    
    if (!routeGeoJson || !routeGeoJson.features || routeGeoJson.features.length === 0) {
      console.error(`Error: No se encontraron características en el GeoJSON de la ruta ${routeId}`);
      process.exit(1);
    }
    
    // 8. Extraer coordenadas
    const routeFeature = routeGeoJson.features[0];
    const routeCoordinates = routeFeature.geometry?.coordinates || [];
    
    if (!routeCoordinates || routeCoordinates.length === 0) {
      console.error(`Error: No se encontraron coordenadas en la ruta ${routeId}`);
      process.exit(1);
    }
    
    console.log(`Encontradas ${routeCoordinates.length} coordenadas para la ruta.`);
    
    // 9. Determinar zona y propiedades
    let zone = 'centro';
    if (routeId >= 1 && routeId <= 30) zone = 'norte';
    if (routeId >= 31 && routeId <= 60) zone = 'sur';
    if (routeId >= 61 && routeId <= 90) zone = 'este';
    if (routeId >= 91 && routeId <= 120) zone = 'oeste';
    
    const color = zoneColors[zone];
    
    // 10. Generar nombres y propiedades
    const routeIdWithOffset = alternateNum === 1 ? routeId : routeId + 100;
    const routeName = `Ruta ${routeId} (Alternativa ${alternateNum})`;
    const shortName = `R${routeId}A${alternateNum}`;
    
    // 11. Verificar si ya existe
    console.log('Verificando si la ruta ya existe...');
    const existingRoutes = await db.query.busRoutes.findMany({
      where: (busRoutes, { eq }) => eq(busRoutes.name, routeName)
    });
    
    if (existingRoutes.length > 0) {
      console.log(`La ruta ${routeName} ya existe en la base de datos, omitiendo...`);
      process.exit(0);
    }
    
    // 12. Crear objeto GeoJSON para la ruta
    const finalRouteGeoJSON = {
      type: 'Feature',
      properties: {
        id: routeIdWithOffset,
        name: routeName,
        shortName: shortName,
        color: color
      },
      geometry: {
        type: 'LineString',
        coordinates: routeCoordinates
      }
    };
    
    // 13. Generar datos complementarios
    const approximateTime = routeCoordinates.length < 50 ? '15-20 min' :
                           routeCoordinates.length < 100 ? '20-30 min' :
                           routeCoordinates.length < 200 ? '30-45 min' :
                           routeCoordinates.length < 300 ? '45-60 min' : '60+ min';
                           
    const frequencies = ['10-15 min', '15-20 min', '20-30 min', '30-40 min', '15-25 min', '20-25 min'];
    const frequency = frequencies[Math.floor(Math.random() * frequencies.length)];
    
    // 14. Crear ruta en la base de datos
    console.log('Creando ruta en la base de datos...');
    const route = await storage.createRoute({
      name: routeName,
      shortName: shortName,
      color: color,
      frequency: frequency,
      scheduleStart: '05:30 AM',
      scheduleEnd: '22:30 PM',
      stopsCount: 0, // Se actualizará después
      approximateTime: approximateTime,
      zone: zone,
      popular: true,
      geoJSON: finalRouteGeoJSON
    });
    
    console.log(`✅ Ruta creada: ${routeName} (ID: ${route.id}) con ${routeCoordinates.length} puntos`);
    
    // 15. Generar paradas automáticamente
    console.log('Generando paradas automáticas...');
    
    // Determinar número óptimo de paradas según longitud de la ruta
    const totalStops = Math.min(
      Math.max(10, Math.floor(routeCoordinates.length / 50)),
      40 // máximo 40 paradas para evitar demasiada densidad
    );
    
    let stopsCount = 0;
    
    // Terminal origen
    console.log('Creando terminal origen...');
    const firstCoord = routeCoordinates[0];
    await storage.createStop({
      routeId: route.id,
      name: `Terminal Origen (R${routeId})`,
      latitude: firstCoord[1].toString(),
      longitude: firstCoord[0].toString(),
      isTerminal: true,
      terminalType: 'first'
    });
    stopsCount++;
    
    // Paradas intermedias
    console.log(`Creando ${totalStops - 2} paradas intermedias...`);
    const step = Math.floor(routeCoordinates.length / (totalStops - 1));
    for (let i = 1; i < totalStops - 1; i++) {
      const index = i * step;
      if (index < routeCoordinates.length) {
        const coord = routeCoordinates[index];
        await storage.createStop({
          routeId: route.id,
          name: `Parada ${i}`,
          latitude: coord[1].toString(),
          longitude: coord[0].toString(),
          isTerminal: false,
          terminalType: ''
        });
        stopsCount++;
      }
    }
    
    // Terminal destino
    console.log('Creando terminal destino...');
    const lastCoord = routeCoordinates[routeCoordinates.length - 1];
    await storage.createStop({
      routeId: route.id,
      name: `Terminal Destino (R${routeId})`,
      latitude: lastCoord[1].toString(),
      longitude: lastCoord[0].toString(),
      isTerminal: true,
      terminalType: 'last'
    });
    stopsCount++;
    
    // Actualizar contador de paradas en la ruta
    console.log(`Actualizando contador de paradas a ${stopsCount}...`);
    await storage.updateRoute(route.id, { stopsCount: stopsCount });
    
    console.log(`✅ Creadas ${stopsCount} paradas para la ruta ${routeId} (alternativa ${alternateNum})`);
    
    // 16. Limpiar directorio temporal
    console.log('Limpiando directorios temporales...');
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    console.log(`Importación de la ruta ${routeId} (alternativa ${alternateNum}) completada con éxito.`);
    process.exit(0);
    
  } catch (error) {
    console.error('Error al importar ruta:', error);
    process.exit(1);
  }
}

// Ejecutar función principal
importarRutaAlternativa();