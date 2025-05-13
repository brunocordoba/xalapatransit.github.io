#!/bin/bash

# Importar rutas que tienen estructura alternativa (subdirectorios ruta_1, ruta_2)
# Estas son típicamente las rutas del 34 al 44

START_ROUTE=${1:-34}
END_ROUTE=${2:-44}

echo "Iniciando importación de rutas alternativas (con estructura ruta_1/ruta_2) desde $START_ROUTE hasta $END_ROUTE"

for ROUTE_NUM in $(seq $START_ROUTE $END_ROUTE); do
  echo "========================================"
  echo "Procesando ruta alternativa $ROUTE_NUM"
  echo "========================================"
  
  # Verificar si existe la carpeta de la ruta
  ROUTE_DIR="./tmp/mapaton-extract/shapefiles-mapton-ciudadano/${ROUTE_NUM}_circuito"
  
  if [ ! -d "$ROUTE_DIR" ]; then
    echo "No existe la carpeta para la ruta $ROUTE_NUM, omitiendo..."
    continue
  fi
  
  # Verificar si tiene subcarpetas ruta_1 o ruta_2
  if [ -d "$ROUTE_DIR/ruta_1" ]; then
    echo "Procesando subcarpeta ruta_1..."
    
    # Crear directorio temporal para procesar esta subrutina
    TEMP_DIR="./tmp/route_${ROUTE_NUM}_1"
    mkdir -p "$TEMP_DIR"
    
    # Copiar archivos necesarios
    cp "$ROUTE_DIR/ruta_1/route.zip" "$TEMP_DIR/" 2>/dev/null
    cp "$ROUTE_DIR/ruta_1/stops.zip" "$TEMP_DIR/" 2>/dev/null
    
    # Procesar
    if [ -f "$TEMP_DIR/route.zip" ]; then
      echo "Importando ruta $ROUTE_NUM (alterna 1)..."
      # Extraer contenido y procesar usando el script existente
      # En este caso, llamamos a nuestro script de importación de rutas
      TSX_CMD="
      import * as fs from 'fs';
      import * as path from 'path';
      import { db } from '../server/db';
      import { busRoutes, busStops } from '../shared/schema';
      import { storage } from '../server/storage';
      import * as util from 'util';
      import { exec } from 'child_process';
      
      // Promisificar exec para usar con async/await
      const execAsync = util.promisify(exec);
      
      // Constantes para directorios y archivos
      const PROCESSED_DIR = './tmp/processed';
      const TEMP_DIR = '$TEMP_DIR';
      
      // Crear directorios de procesamiento si no existen
      if (!fs.existsSync(PROCESSED_DIR)) {
        fs.mkdirSync(PROCESSED_DIR, { recursive: true });
      }
      
      // Colores para zonas
      const zoneColors: Record<string, string> = {
        'norte': '#EF4444', // red-500
        'sur': '#3B82F6',   // blue-500
        'este': '#22C55E',  // green-500
        'oeste': '#A855F7', // purple-500
        'centro': '#F97316' // orange-500
      };
      
      async function processAlternateRoute() {
        try {
          const routeId = ${ROUTE_NUM};
          console.log(\`Procesando ruta alternativa \${routeId}...\`);
          
          // Verificar archivos de ruta y paradas
          const routeZipPath = path.join(TEMP_DIR, 'route.zip');
          const stopsZipPath = path.join(TEMP_DIR, 'stops.zip');
          
          if (!fs.existsSync(routeZipPath)) {
            throw new Error(\`Archivo route.zip no encontrado en \${TEMP_DIR}\`);
          }
          
          // Crear directorios temporales para extracción
          const tmpDir = path.join(PROCESSED_DIR, \`route_\${routeId}_alt1\`);
          if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
          }
          
          const routeShpDir = path.join(tmpDir, 'route');
          if (!fs.existsSync(routeShpDir)) {
            fs.mkdirSync(routeShpDir, { recursive: true });
          }
          
          const stopsShpDir = path.join(tmpDir, 'stops');
          if (!fs.existsSync(stopsShpDir)) {
            fs.mkdirSync(stopsShpDir, { recursive: true });
          }
          
          try {
            // Extraer archivo de ruta
            await execAsync(\`unzip -o \${routeZipPath} -d \${routeShpDir}\`);
            
            // Buscar archivo .shp para la ruta
            const routeShpFiles = fs.readdirSync(routeShpDir)
              .filter(file => file.endsWith('.shp'))
              .map(file => path.join(routeShpDir, file));
              
            if (routeShpFiles.length === 0) {
              throw new Error(\`No se encontraron archivos .shp en \${routeShpDir}\`);
            }
            
            // Convertir shapefile de ruta a GeoJSON
            const routeShpFile = routeShpFiles[0];
            const routeGeoJsonFile = path.join(tmpDir, 'route.geojson');
            
            await execAsync(\`ogr2ogr -f GeoJSON \${routeGeoJsonFile} \${routeShpFile}\`);
            
            if (!fs.existsSync(routeGeoJsonFile)) {
              throw new Error(\`Error al convertir shapefile a GeoJSON: \${routeShpFile}\`);
            }
            
            // Leer archivo GeoJSON y extraer datos
            const routeGeoJson = JSON.parse(fs.readFileSync(routeGeoJsonFile, 'utf8'));
            
            if (!routeGeoJson || !routeGeoJson.features || routeGeoJson.features.length === 0) {
              throw new Error(\`No se encontraron características en el GeoJSON de la ruta\`);
            }
            
            // Usar primera característica como ruta
            const routeFeature = routeGeoJson.features[0];
            const routeCoordinates = routeFeature.geometry?.coordinates || [];
            
            if (!routeCoordinates || routeCoordinates.length === 0) {
              throw new Error(\`No se encontraron coordenadas en la ruta\`);
            }
            
            // Determinar zona
            let zone = 'centro';
            if (routeId >= 1 && routeId <= 30) zone = 'norte';
            if (routeId >= 31 && routeId <= 60) zone = 'sur';
            if (routeId >= 61 && routeId <= 90) zone = 'este';
            if (routeId >= 91 && routeId <= 120) zone = 'oeste';
            
            // Generar nombre y color
            const routeName = \`Ruta \${routeId} (Alterna 1)\`;
            const shortName = \`R\${routeId}A1\`;
            const color = zoneColors[zone];
            
            // Verificar si ya existe
            const existingRoutes = await db.query.busRoutes.findMany({
              where: (busRoutes, { eq }) => eq(busRoutes.name, routeName)
            });
            
            if (existingRoutes.length > 0) {
              console.log(\`La ruta \${routeName} ya existe en la base de datos, omitiendo...\`);
              return { success: true, message: 'La ruta ya existe' };
            }
            
            // Crear objeto GeoJSON para la ruta
            const finalRouteGeoJSON = {
              type: 'Feature',
              properties: {
                id: routeId,
                name: routeName,
                shortName: shortName,
                color: color
              },
              geometry: {
                type: 'LineString',
                coordinates: routeCoordinates
              }
            };
            
            // Generar datos complementarios
            const approximateTime = routeCoordinates.length < 50 ? '15-20 min' :
                                   routeCoordinates.length < 100 ? '20-30 min' :
                                   routeCoordinates.length < 200 ? '30-45 min' :
                                   routeCoordinates.length < 300 ? '45-60 min' : '60+ min';
                                   
            const frequencies = ['10-15 min', '15-20 min', '20-30 min', '30-40 min', '15-25 min', '20-25 min'];
            const frequency = frequencies[Math.floor(Math.random() * frequencies.length)];
            
            // Crear ruta en la base de datos
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
            
            console.log(\`✅ Ruta creada: \${routeName} (ID: \${route.id}) con \${routeCoordinates.length} puntos\`);
            
            // Procesar paradas si existen
            let stopsCount = 0;
            
            try {
              if (fs.existsSync(stopsZipPath)) {
                // Extraer archivo de paradas
                await execAsync(\`unzip -o \${stopsZipPath} -d \${stopsShpDir}\`);
                
                // Buscar archivo .shp para las paradas
                const stopsShpFiles = fs.readdirSync(stopsShpDir)
                  .filter(file => file.endsWith('.shp'))
                  .map(file => path.join(stopsShpDir, file));
                
                if (stopsShpFiles.length > 0) {
                  // Convertir shapefile de paradas a GeoJSON
                  const stopsShpFile = stopsShpFiles[0];
                  const stopsGeoJsonFile = path.join(tmpDir, 'stops.geojson');
                  
                  await execAsync(\`ogr2ogr -f GeoJSON \${stopsGeoJsonFile} \${stopsShpFile}\`);
                  
                  if (fs.existsSync(stopsGeoJsonFile)) {
                    // Leer archivo GeoJSON y extraer datos
                    const stopsGeoJson = JSON.parse(fs.readFileSync(stopsGeoJsonFile, 'utf8'));
                    
                    if (stopsGeoJson && stopsGeoJson.features && stopsGeoJson.features.length > 0) {
                      // Crear paradas
                      const features = stopsGeoJson.features || [];
                      
                      // Primera parada es terminal origen
                      if (features.length > 0) {
                        const firstStop = features[0];
                        const firstCoord = firstStop.geometry.coordinates;
                        
                        await storage.createStop({
                          routeId: route.id,
                          name: \`Terminal Origen (R\${routeId})\`,
                          latitude: firstCoord[1].toString(),
                          longitude: firstCoord[0].toString(),
                          isTerminal: true,
                          terminalType: 'first'
                        });
                        stopsCount++;
                      }
                      
                      // Paradas intermedias
                      for (let i = 1; i < features.length - 1; i++) {
                        const stop = features[i];
                        const coord = stop.geometry.coordinates;
                        
                        await storage.createStop({
                          routeId: route.id,
                          name: \`Parada \${i}\`,
                          latitude: coord[1].toString(),
                          longitude: coord[0].toString(),
                          isTerminal: false,
                          terminalType: ''
                        });
                        stopsCount++;
                      }
                      
                      // Última parada es terminal destino
                      if (features.length > 1) {
                        const lastStop = features[features.length - 1];
                        const lastCoord = lastStop.geometry.coordinates;
                        
                        await storage.createStop({
                          routeId: route.id,
                          name: \`Terminal Destino (R\${routeId})\`,
                          latitude: lastCoord[1].toString(),
                          longitude: lastCoord[0].toString(),
                          isTerminal: true,
                          terminalType: 'last'
                        });
                        stopsCount++;
                      }
                      
                      // Actualizar contador de paradas en la ruta
                      await storage.updateRoute(route.id, { stopsCount: stopsCount });
                      
                      console.log(\`✅ Creadas \${stopsCount} paradas para la ruta \${route.id}\`);
                      return { success: true, route, stopsCount };
                    }
                  }
                }
              }
              
              // Si no hay paradas o hay error al procesarlas, generar automáticamente
              console.log(\`Generando paradas automáticamente...\`);
              
              // Determinar número óptimo de paradas según longitud de la ruta
              const totalStops = Math.min(
                Math.max(10, Math.floor(routeCoordinates.length / 50)),
                40 // máximo 40 paradas para tener una mejor distribución
              );
              
              // Terminal origen
              const firstCoord = routeCoordinates[0];
              await storage.createStop({
                routeId: route.id,
                name: \`Terminal Origen (R\${routeId})\`,
                latitude: firstCoord[1].toString(),
                longitude: firstCoord[0].toString(),
                isTerminal: true,
                terminalType: 'first'
              });
              stopsCount++;
              
              // Paradas intermedias
              const step = Math.floor(routeCoordinates.length / (totalStops - 1));
              for (let i = 1; i < totalStops - 1; i++) {
                const index = i * step;
                if (index < routeCoordinates.length) {
                  const coord = routeCoordinates[index];
                  await storage.createStop({
                    routeId: route.id,
                    name: \`Parada \${i}\`,
                    latitude: coord[1].toString(),
                    longitude: coord[0].toString(),
                    isTerminal: false,
                    terminalType: ''
                  });
                  stopsCount++;
                }
              }
              
              // Terminal destino
              const lastCoord = routeCoordinates[routeCoordinates.length - 1];
              await storage.createStop({
                routeId: route.id,
                name: \`Terminal Destino (R\${routeId})\`,
                latitude: lastCoord[1].toString(),
                longitude: lastCoord[0].toString(),
                isTerminal: true,
                terminalType: 'last'
              });
              stopsCount++;
              
              // Actualizar contador de paradas en la ruta
              await storage.updateRoute(route.id, { stopsCount: stopsCount });
              
              console.log(\`✅ Creadas \${stopsCount} paradas para la ruta \${route.id}\`);
              return { success: true, route, stopsCount };
              
            } catch (error) {
              console.error(\`Error procesando paradas para ruta \${routeId}:\`, error);
              return { success: true, route, stopsCount: 0 };
            }
          } catch (error) {
            console.error(\`Error procesando ruta \${routeId}:\`, error);
            throw error;
          }
        } catch (error) {
          console.error('Error en el procesamiento general:', error);
          return { success: false, message: error.message };
        }
      }
      
      async function main() {
        try {
          const result = await processAlternateRoute();
          console.log(JSON.stringify(result));
          process.exit(0);
        } catch (error) {
          console.error('Error en procesamiento principal:', error);
          process.exit(1);
        }
      }
      
      main();
      "
      
      # Ejecutar script temporal 
      tsx -e "$TSX_CMD"
    else
      echo "No se encontró archivo de ruta en ruta_1"
    fi
    
    # Limpiar
    rm -rf "$TEMP_DIR"
  fi
  
  # Verificar si tiene ruta_2 y procesarla
  if [ -d "$ROUTE_DIR/ruta_2" ]; then
    echo "Procesando subcarpeta ruta_2..."
    
    # Crear directorio temporal para procesar esta subrutina
    TEMP_DIR="./tmp/route_${ROUTE_NUM}_2"
    mkdir -p "$TEMP_DIR"
    
    # Copiar archivos necesarios
    cp "$ROUTE_DIR/ruta_2/route.zip" "$TEMP_DIR/" 2>/dev/null
    cp "$ROUTE_DIR/ruta_2/stops.zip" "$TEMP_DIR/" 2>/dev/null
    
    # Procesar
    if [ -f "$TEMP_DIR/route.zip" ]; then
      echo "Importando ruta $ROUTE_NUM (alterna 2)..."
      # Similar to above but with 'Alterna 2' naming
      TSX_CMD="
      import * as fs from 'fs';
      import * as path from 'path';
      import { db } from '../server/db';
      import { busRoutes, busStops } from '../shared/schema';
      import { storage } from '../server/storage';
      import * as util from 'util';
      import { exec } from 'child_process';
      
      // Promisificar exec para usar con async/await
      const execAsync = util.promisify(exec);
      
      // Constantes para directorios y archivos
      const PROCESSED_DIR = './tmp/processed';
      const TEMP_DIR = '$TEMP_DIR';
      
      // Crear directorios de procesamiento si no existen
      if (!fs.existsSync(PROCESSED_DIR)) {
        fs.mkdirSync(PROCESSED_DIR, { recursive: true });
      }
      
      // Colores para zonas
      const zoneColors: Record<string, string> = {
        'norte': '#EF4444', // red-500
        'sur': '#3B82F6',   // blue-500
        'este': '#22C55E',  // green-500
        'oeste': '#A855F7', // purple-500
        'centro': '#F97316' // orange-500
      };
      
      async function processAlternateRoute() {
        try {
          const routeId = ${ROUTE_NUM};
          const routeIdWithOffset = routeId + 100; // Usamos offset para la ruta 2
          console.log(\`Procesando ruta alternativa \${routeId} (vuelta)...\`);
          
          // Verificar archivos de ruta y paradas
          const routeZipPath = path.join(TEMP_DIR, 'route.zip');
          const stopsZipPath = path.join(TEMP_DIR, 'stops.zip');
          
          if (!fs.existsSync(routeZipPath)) {
            throw new Error(\`Archivo route.zip no encontrado en \${TEMP_DIR}\`);
          }
          
          // Crear directorios temporales para extracción
          const tmpDir = path.join(PROCESSED_DIR, \`route_\${routeId}_alt2\`);
          if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
          }
          
          const routeShpDir = path.join(tmpDir, 'route');
          if (!fs.existsSync(routeShpDir)) {
            fs.mkdirSync(routeShpDir, { recursive: true });
          }
          
          const stopsShpDir = path.join(tmpDir, 'stops');
          if (!fs.existsSync(stopsShpDir)) {
            fs.mkdirSync(stopsShpDir, { recursive: true });
          }
          
          try {
            // Extraer archivo de ruta
            await execAsync(\`unzip -o \${routeZipPath} -d \${routeShpDir}\`);
            
            // Buscar archivo .shp para la ruta
            const routeShpFiles = fs.readdirSync(routeShpDir)
              .filter(file => file.endsWith('.shp'))
              .map(file => path.join(routeShpDir, file));
              
            if (routeShpFiles.length === 0) {
              throw new Error(\`No se encontraron archivos .shp en \${routeShpDir}\`);
            }
            
            // Convertir shapefile de ruta a GeoJSON
            const routeShpFile = routeShpFiles[0];
            const routeGeoJsonFile = path.join(tmpDir, 'route.geojson');
            
            await execAsync(\`ogr2ogr -f GeoJSON \${routeGeoJsonFile} \${routeShpFile}\`);
            
            if (!fs.existsSync(routeGeoJsonFile)) {
              throw new Error(\`Error al convertir shapefile a GeoJSON: \${routeShpFile}\`);
            }
            
            // Leer archivo GeoJSON y extraer datos
            const routeGeoJson = JSON.parse(fs.readFileSync(routeGeoJsonFile, 'utf8'));
            
            if (!routeGeoJson || !routeGeoJson.features || routeGeoJson.features.length === 0) {
              throw new Error(\`No se encontraron características en el GeoJSON de la ruta\`);
            }
            
            // Usar primera característica como ruta
            const routeFeature = routeGeoJson.features[0];
            const routeCoordinates = routeFeature.geometry?.coordinates || [];
            
            if (!routeCoordinates || routeCoordinates.length === 0) {
              throw new Error(\`No se encontraron coordenadas en la ruta\`);
            }
            
            // Determinar zona
            let zone = 'centro';
            if (routeId >= 1 && routeId <= 30) zone = 'norte';
            if (routeId >= 31 && routeId <= 60) zone = 'sur';
            if (routeId >= 61 && routeId <= 90) zone = 'este';
            if (routeId >= 91 && routeId <= 120) zone = 'oeste';
            
            // Generar nombre y color
            const routeName = \`Ruta \${routeId} (Alterna 2)\`;
            const shortName = \`R\${routeId}A2\`;
            const color = zoneColors[zone];
            
            // Verificar si ya existe
            const existingRoutes = await db.query.busRoutes.findMany({
              where: (busRoutes, { eq }) => eq(busRoutes.name, routeName)
            });
            
            if (existingRoutes.length > 0) {
              console.log(\`La ruta \${routeName} ya existe en la base de datos, omitiendo...\`);
              return { success: true, message: 'La ruta ya existe' };
            }
            
            // Crear objeto GeoJSON para la ruta
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
            
            // Generar datos complementarios
            const approximateTime = routeCoordinates.length < 50 ? '15-20 min' :
                                   routeCoordinates.length < 100 ? '20-30 min' :
                                   routeCoordinates.length < 200 ? '30-45 min' :
                                   routeCoordinates.length < 300 ? '45-60 min' : '60+ min';
                                   
            const frequencies = ['10-15 min', '15-20 min', '20-30 min', '30-40 min', '15-25 min', '20-25 min'];
            const frequency = frequencies[Math.floor(Math.random() * frequencies.length)];
            
            // Crear ruta en la base de datos
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
            
            console.log(\`✅ Ruta creada: \${routeName} (ID: \${route.id}) con \${routeCoordinates.length} puntos\`);
            
            // Procesar paradas si existen
            let stopsCount = 0;
            
            try {
              if (fs.existsSync(stopsZipPath)) {
                // Extraer archivo de paradas
                await execAsync(\`unzip -o \${stopsZipPath} -d \${stopsShpDir}\`);
                
                // Buscar archivo .shp para las paradas
                const stopsShpFiles = fs.readdirSync(stopsShpDir)
                  .filter(file => file.endsWith('.shp'))
                  .map(file => path.join(stopsShpDir, file));
                
                if (stopsShpFiles.length > 0) {
                  // Convertir shapefile de paradas a GeoJSON
                  const stopsShpFile = stopsShpFiles[0];
                  const stopsGeoJsonFile = path.join(tmpDir, 'stops.geojson');
                  
                  await execAsync(\`ogr2ogr -f GeoJSON \${stopsGeoJsonFile} \${stopsShpFile}\`);
                  
                  if (fs.existsSync(stopsGeoJsonFile)) {
                    // Leer archivo GeoJSON y extraer datos
                    const stopsGeoJson = JSON.parse(fs.readFileSync(stopsGeoJsonFile, 'utf8'));
                    
                    if (stopsGeoJson && stopsGeoJson.features && stopsGeoJson.features.length > 0) {
                      // Crear paradas
                      const features = stopsGeoJson.features || [];
                      
                      // Primera parada es terminal origen
                      if (features.length > 0) {
                        const firstStop = features[0];
                        const firstCoord = firstStop.geometry.coordinates;
                        
                        await storage.createStop({
                          routeId: route.id,
                          name: \`Terminal Origen (R\${routeId})\`,
                          latitude: firstCoord[1].toString(),
                          longitude: firstCoord[0].toString(),
                          isTerminal: true,
                          terminalType: 'first'
                        });
                        stopsCount++;
                      }
                      
                      // Paradas intermedias
                      for (let i = 1; i < features.length - 1; i++) {
                        const stop = features[i];
                        const coord = stop.geometry.coordinates;
                        
                        await storage.createStop({
                          routeId: route.id,
                          name: \`Parada \${i}\`,
                          latitude: coord[1].toString(),
                          longitude: coord[0].toString(),
                          isTerminal: false,
                          terminalType: ''
                        });
                        stopsCount++;
                      }
                      
                      // Última parada es terminal destino
                      if (features.length > 1) {
                        const lastStop = features[features.length - 1];
                        const lastCoord = lastStop.geometry.coordinates;
                        
                        await storage.createStop({
                          routeId: route.id,
                          name: \`Terminal Destino (R\${routeId})\`,
                          latitude: lastCoord[1].toString(),
                          longitude: lastCoord[0].toString(),
                          isTerminal: true,
                          terminalType: 'last'
                        });
                        stopsCount++;
                      }
                      
                      // Actualizar contador de paradas en la ruta
                      await storage.updateRoute(route.id, { stopsCount: stopsCount });
                      
                      console.log(\`✅ Creadas \${stopsCount} paradas para la ruta \${route.id}\`);
                      return { success: true, route, stopsCount };
                    }
                  }
                }
              }
              
              // Si no hay paradas o hay error al procesarlas, generar automáticamente
              console.log(\`Generando paradas automáticamente...\`);
              
              // Determinar número óptimo de paradas según longitud de la ruta
              const totalStops = Math.min(
                Math.max(10, Math.floor(routeCoordinates.length / 50)),
                40 // máximo 40 paradas para tener una mejor distribución
              );
              
              // Terminal origen
              const firstCoord = routeCoordinates[0];
              await storage.createStop({
                routeId: route.id,
                name: \`Terminal Origen (R\${routeId})\`,
                latitude: firstCoord[1].toString(),
                longitude: firstCoord[0].toString(),
                isTerminal: true,
                terminalType: 'first'
              });
              stopsCount++;
              
              // Paradas intermedias
              const step = Math.floor(routeCoordinates.length / (totalStops - 1));
              for (let i = 1; i < totalStops - 1; i++) {
                const index = i * step;
                if (index < routeCoordinates.length) {
                  const coord = routeCoordinates[index];
                  await storage.createStop({
                    routeId: route.id,
                    name: \`Parada \${i}\`,
                    latitude: coord[1].toString(),
                    longitude: coord[0].toString(),
                    isTerminal: false,
                    terminalType: ''
                  });
                  stopsCount++;
                }
              }
              
              // Terminal destino
              const lastCoord = routeCoordinates[routeCoordinates.length - 1];
              await storage.createStop({
                routeId: route.id,
                name: \`Terminal Destino (R\${routeId})\`,
                latitude: lastCoord[1].toString(),
                longitude: lastCoord[0].toString(),
                isTerminal: true,
                terminalType: 'last'
              });
              stopsCount++;
              
              // Actualizar contador de paradas en la ruta
              await storage.updateRoute(route.id, { stopsCount: stopsCount });
              
              console.log(\`✅ Creadas \${stopsCount} paradas para la ruta \${route.id}\`);
              return { success: true, route, stopsCount };
              
            } catch (error) {
              console.error(\`Error procesando paradas para ruta \${routeId}:\`, error);
              return { success: true, route, stopsCount: 0 };
            }
          } catch (error) {
            console.error(\`Error procesando ruta \${routeId}:\`, error);
            throw error;
          }
        } catch (error) {
          console.error('Error en el procesamiento general:', error);
          return { success: false, message: error.message };
        }
      }
      
      async function main() {
        try {
          const result = await processAlternateRoute();
          console.log(JSON.stringify(result));
          process.exit(0);
        } catch (error) {
          console.error('Error en procesamiento principal:', error);
          process.exit(1);
        }
      }
      
      main();
      "
      
      # Ejecutar script temporal 
      tsx -e "$TSX_CMD"
    else
      echo "No se encontró archivo de ruta en ruta_2"
    fi
    
    # Limpiar
    rm -rf "$TEMP_DIR"
  fi
  
  echo "Ruta $ROUTE_NUM procesada"
done

echo "Finalizada importación de rutas alternativas $START_ROUTE a $END_ROUTE"