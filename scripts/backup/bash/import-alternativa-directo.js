#!/usr/bin/env node

/**
 * Script para importar una ruta alternativa directamente desde línea de comandos
 * Uso: node scripts/import-alternativa-directo.js <numero_ruta> <numero_alternativa>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parámetros de la línea de comandos
const routeId = parseInt(process.argv[2], 10);
const alternateNum = parseInt(process.argv[3], 10);

if (isNaN(routeId) || isNaN(alternateNum) || alternateNum < 1 || alternateNum > 2) {
  console.error('Uso: node scripts/import-alternativa-directo.js <numero_ruta> <numero_alternativa>');
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

// Determinar zona por ID de ruta
function determineZone(routeId) {
  let zone = 'centro';
  if (routeId >= 1 && routeId <= 30) zone = 'norte';
  if (routeId >= 31 && routeId <= 60) zone = 'sur';
  if (routeId >= 61 && routeId <= 90) zone = 'este';
  if (routeId >= 91 && routeId <= 120) zone = 'oeste';
  return zone;
}

// Función principal para importar la ruta
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
    const zone = determineZone(routeId);
    const color = zoneColors[zone];
    
    // 10. Generar nombres y propiedades
    const routeIdWithOffset = alternateNum === 1 ? routeId : routeId + 100;
    const routeName = `Ruta ${routeId} (Alternativa ${alternateNum})`;
    const shortName = `R${routeId}A${alternateNum}`;
    
    // 11. Verificar si ya existe
    console.log('Verificando si la ruta ya existe...');
    const checkSql = `
      SELECT COUNT(*) as count FROM "BusRoute" WHERE name = '${routeName}';
    `;
    
    try {
      const checkResult = execSync(`psql "$DATABASE_URL" -c "${checkSql}"`).toString();
      const count = parseInt(checkResult.match(/\((\d+) row/)[1], 10);
      
      if (count > 0) {
        console.log(`La ruta ${routeName} ya existe en la base de datos, omitiendo...`);
        // Limpiar directorio temporal
        fs.rmSync(tempDir, { recursive: true, force: true });
        process.exit(0);
      }
    } catch (error) {
      console.error('Error verificando existencia de ruta:', error.message);
      process.exit(1);
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
    
    // 14. Crear ruta en la base de datos directamente con SQL
    console.log('Creando ruta en la base de datos...');
    
    const geoJSONStr = JSON.stringify(finalRouteGeoJSON).replace(/'/g, "''");
    
    const insertRouteSql = `
      INSERT INTO "BusRoute" (name, "shortName", color, frequency, "scheduleStart", "scheduleEnd", 
                             "stopsCount", "approximateTime", zone, popular, "geoJSON")
      VALUES ('${routeName}', '${shortName}', '${color}', '${frequency}', '05:30 AM', 
              '22:30 PM', 0, '${approximateTime}', '${zone}', TRUE, '${geoJSONStr}')
      RETURNING id;
    `;
    
    let routeId;
    try {
      const insertResult = execSync(`psql "$DATABASE_URL" -c "${insertRouteSql}"`).toString();
      routeId = parseInt(insertResult.match(/\(1 row\)[\s\S]*?(\d+)/)[1], 10);
      console.log(`✅ Ruta creada: ${routeName} (ID: ${routeId}) con ${routeCoordinates.length} puntos`);
    } catch (error) {
      console.error('Error creando ruta:', error.message);
      process.exit(1);
    }
    
    if (!routeId) {
      console.error('No se pudo obtener el ID de la ruta creada');
      process.exit(1);
    }
    
    // 15. Generar paradas automáticamente
    console.log('Generando paradas automáticas...');
    
    // Determinar número óptimo de paradas según longitud de la ruta
    const totalStops = Math.min(
      Math.max(10, Math.floor(routeCoordinates.length / 50)),
      40 // máximo 40 paradas para evitar demasiada densidad
    );
    
    let stopsCount = 0;
    let stopsInsertSql = 'INSERT INTO "BusStop" ("routeId", name, latitude, longitude, "isTerminal", "terminalType") VALUES\n';
    
    // Terminal origen
    console.log('Creando terminal origen...');
    const firstCoord = routeCoordinates[0];
    stopsInsertSql += `(${routeId}, 'Terminal Origen (R${routeId})', '${firstCoord[1]}', '${firstCoord[0]}', TRUE, 'first')`;
    stopsCount++;
    
    // Paradas intermedias
    console.log(`Creando ${totalStops - 2} paradas intermedias...`);
    const step = Math.floor(routeCoordinates.length / (totalStops - 1));
    for (let i = 1; i < totalStops - 1; i++) {
      const index = i * step;
      if (index < routeCoordinates.length) {
        const coord = routeCoordinates[index];
        stopsInsertSql += `,\n(${routeId}, 'Parada ${i}', '${coord[1]}', '${coord[0]}', FALSE, '')`;
        stopsCount++;
      }
    }
    
    // Terminal destino
    console.log('Creando terminal destino...');
    const lastCoord = routeCoordinates[routeCoordinates.length - 1];
    stopsInsertSql += `,\n(${routeId}, 'Terminal Destino (R${routeId})', '${lastCoord[1]}', '${lastCoord[0]}', TRUE, 'last')`;
    stopsCount++;
    
    stopsInsertSql += ';';
    
    try {
      execSync(`psql "$DATABASE_URL" -c "${stopsInsertSql}"`);
      console.log(`✅ Creadas ${stopsCount} paradas para la ruta ${routeId}`);
    } catch (error) {
      console.error('Error creando paradas:', error.message);
      process.exit(1);
    }
    
    // Actualizar contador de paradas en la ruta
    console.log(`Actualizando contador de paradas a ${stopsCount}...`);
    const updateStopsCountSql = `
      UPDATE "BusRoute" SET "stopsCount" = ${stopsCount} WHERE id = ${routeId};
    `;
    
    try {
      execSync(`psql "$DATABASE_URL" -c "${updateStopsCountSql}"`);
    } catch (error) {
      console.error('Error actualizando contador de paradas:', error.message);
    }
    
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