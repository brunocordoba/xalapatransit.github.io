#!/bin/bash

# Script para importar rutas alternativas (34-44) que tienen estructura con ruta_1 y ruta_2

# Recibe parámetros para el rango de rutas
START_ROUTE=${1:-34}
END_ROUTE=${2:-44}

echo "Iniciando importación de rutas alternativas (con estructura ruta_1/ruta_2) desde $START_ROUTE hasta $END_ROUTE"

# Contador de resultados
ROUTES_IMPORTED=0
STOPS_CREATED=0
ERRORS=0

# Directorio base donde se encuentran las rutas
BASE_DIR="./tmp/mapaton-extract/shapefiles-mapton-ciudadano"

for ROUTE_ID in $(seq $START_ROUTE $END_ROUTE); do
  echo "=========================================="
  echo "Procesando ruta alternativa $ROUTE_ID"
  echo "=========================================="
  
  ROUTE_DIR="${BASE_DIR}/${ROUTE_ID}_circuito"
  
  # Verificar si existe el directorio de la ruta
  if [ ! -d "$ROUTE_DIR" ]; then
    echo "⚠️ No existe la carpeta para la ruta $ROUTE_ID, omitiendo..."
    continue
  fi
  
  # Procesar subcarpeta ruta_1 si existe
  if [ -d "$ROUTE_DIR/ruta_1" ]; then
    echo "Procesando subcarpeta ruta_1 para ruta $ROUTE_ID..."
    
    # Directorio temporal para extraer archivos
    TMP_DIR="./tmp/route_${ROUTE_ID}_alt1"
    mkdir -p "$TMP_DIR"
    mkdir -p "$TMP_DIR/route"
    mkdir -p "$TMP_DIR/stops"
    
    # Verificar si existen los archivos necesarios
    if [ -f "$ROUTE_DIR/ruta_1/route.zip" ]; then
      # Extraer archivo de ruta
      echo "Extrayendo route.zip..."
      unzip -o "$ROUTE_DIR/ruta_1/route.zip" -d "$TMP_DIR/route"
      
      # Buscar archivo .shp
      SHP_FILE=$(find "$TMP_DIR/route" -name "*.shp" | head -1)
      
      if [ -n "$SHP_FILE" ]; then
        echo "Convirtiendo shapefile a GeoJSON..."
        ogr2ogr -f GeoJSON "$TMP_DIR/route.geojson" "$SHP_FILE"
        
        # Ejecutar script para importar esta ruta
        echo "Importando ruta $ROUTE_ID (alternativa 1)..."
        
        # Usamos tsx para ejecutar un script TypeScript directo
        tsx -e "
          import fs from 'fs';
          import { db } from '../server/db';
          import { storage } from '../server/storage';
          
          async function importRoute() {
            try {
              // Leer el archivo GeoJSON
              const routeGeoJson = JSON.parse(fs.readFileSync('$TMP_DIR/route.geojson', 'utf8'));
              
              if (!routeGeoJson || !routeGeoJson.features || routeGeoJson.features.length === 0) {
                throw new Error('No se encontraron características en el GeoJSON');
              }
              
              // Extraer coordenadas
              const routeFeature = routeGeoJson.features[0];
              const routeCoordinates = routeFeature.geometry?.coordinates || [];
              
              if (!routeCoordinates || routeCoordinates.length === 0) {
                throw new Error('No se encontraron coordenadas en la ruta');
              }
              
              // Determinar zona
              let zone = 'centro';
              if ($ROUTE_ID >= 1 && $ROUTE_ID <= 30) zone = 'norte';
              if ($ROUTE_ID >= 31 && $ROUTE_ID <= 60) zone = 'sur';
              if ($ROUTE_ID >= 61 && $ROUTE_ID <= 90) zone = 'este';
              if ($ROUTE_ID >= 91 && $ROUTE_ID <= 120) zone = 'oeste';
              
              // Colores para zonas
              const zoneColors = {
                'norte': '#EF4444', // red-500
                'sur': '#3B82F6',   // blue-500
                'este': '#22C55E',  // green-500
                'oeste': '#A855F7', // purple-500
                'centro': '#F97316' // orange-500
              };
              
              // Generar nombre y color
              const routeName = 'Ruta $ROUTE_ID (Alternativa 1)';
              const shortName = 'R${ROUTE_ID}A1';
              const color = zoneColors[zone];
              
              // Verificar si ya existe
              const existingRoutes = await db.query.busRoutes.findMany({
                where: (busRoutes, { eq }) => eq(busRoutes.name, routeName)
              });
              
              if (existingRoutes.length > 0) {
                console.log('La ruta ' + routeName + ' ya existe en la base de datos, omitiendo...');
                process.exit(0);
              }
              
              // Crear objeto GeoJSON para la ruta
              const finalRouteGeoJSON = {
                type: 'Feature',
                properties: {
                  id: $ROUTE_ID,
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
              
              console.log('✅ Ruta creada: ' + routeName + ' (ID: ' + route.id + ') con ' + routeCoordinates.length + ' puntos');
              
              // Generar paradas automáticamente
              const totalStops = Math.min(
                Math.max(10, Math.floor(routeCoordinates.length / 50)),
                40 // máximo 40 paradas
              );
              
              let stopsCount = 0;
              
              // Terminal origen
              const firstCoord = routeCoordinates[0];
              await storage.createStop({
                routeId: route.id,
                name: 'Terminal Origen (R${ROUTE_ID})',
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
                    name: 'Parada ' + i,
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
                name: 'Terminal Destino (R${ROUTE_ID})',
                latitude: lastCoord[1].toString(),
                longitude: lastCoord[0].toString(),
                isTerminal: true,
                terminalType: 'last'
              });
              stopsCount++;
              
              // Actualizar contador de paradas en la ruta
              await storage.updateRoute(route.id, { stopsCount: stopsCount });
              
              console.log('✅ Creadas ' + stopsCount + ' paradas para la ruta ' + route.id);
              console.log(JSON.stringify({ routeId: route.id, stopsCount: stopsCount }));
              process.exit(0);
            } catch (error) {
              console.error('Error importando ruta:', error);
              process.exit(1);
            }
          }
          
          importRoute();
        "
        
        if [ $? -eq 0 ]; then
          echo "✅ Ruta alternativa 1 importada correctamente"
          ROUTES_IMPORTED=$((ROUTES_IMPORTED + 1))
          # Buscar el número de paradas creadas en la salida
          STOPS=$(grep -o "Creadas [0-9]* paradas" | grep -o "[0-9]*" || echo "0")
          STOPS_CREATED=$((STOPS_CREATED + STOPS))
        else
          echo "❌ Error al importar ruta alternativa 1"
          ERRORS=$((ERRORS + 1))
        fi
      else
        echo "❌ No se encontró archivo .shp en route.zip"
        ERRORS=$((ERRORS + 1))
      fi
    else
      echo "❌ No se encontró archivo route.zip en ruta_1"
      ERRORS=$((ERRORS + 1))
    fi
    
    # Limpiar directorio temporal
    rm -rf "$TMP_DIR"
  fi
  
  # Procesar subcarpeta ruta_2 si existe
  if [ -d "$ROUTE_DIR/ruta_2" ]; then
    echo "Procesando subcarpeta ruta_2 para ruta $ROUTE_ID..."
    
    # Directorio temporal para extraer archivos
    TMP_DIR="./tmp/route_${ROUTE_ID}_alt2"
    mkdir -p "$TMP_DIR"
    mkdir -p "$TMP_DIR/route"
    mkdir -p "$TMP_DIR/stops"
    
    # Verificar si existen los archivos necesarios
    if [ -f "$ROUTE_DIR/ruta_2/route.zip" ]; then
      # Extraer archivo de ruta
      echo "Extrayendo route.zip..."
      unzip -o "$ROUTE_DIR/ruta_2/route.zip" -d "$TMP_DIR/route"
      
      # Buscar archivo .shp
      SHP_FILE=$(find "$TMP_DIR/route" -name "*.shp" | head -1)
      
      if [ -n "$SHP_FILE" ]; then
        echo "Convirtiendo shapefile a GeoJSON..."
        ogr2ogr -f GeoJSON "$TMP_DIR/route.geojson" "$SHP_FILE"
        
        # Ejecutar script para importar esta ruta
        echo "Importando ruta $ROUTE_ID (alternativa 2)..."
        
        # Usamos tsx para ejecutar un script TypeScript directo
        tsx -e "
          import fs from 'fs';
          import { db } from '../server/db';
          import { storage } from '../server/storage';
          
          async function importRoute() {
            try {
              // Usar ID con offset para la alternativa 2
              const routeIdWithOffset = $ROUTE_ID + 100;
              
              // Leer el archivo GeoJSON
              const routeGeoJson = JSON.parse(fs.readFileSync('$TMP_DIR/route.geojson', 'utf8'));
              
              if (!routeGeoJson || !routeGeoJson.features || routeGeoJson.features.length === 0) {
                throw new Error('No se encontraron características en el GeoJSON');
              }
              
              // Extraer coordenadas
              const routeFeature = routeGeoJson.features[0];
              const routeCoordinates = routeFeature.geometry?.coordinates || [];
              
              if (!routeCoordinates || routeCoordinates.length === 0) {
                throw new Error('No se encontraron coordenadas en la ruta');
              }
              
              // Determinar zona
              let zone = 'centro';
              if ($ROUTE_ID >= 1 && $ROUTE_ID <= 30) zone = 'norte';
              if ($ROUTE_ID >= 31 && $ROUTE_ID <= 60) zone = 'sur';
              if ($ROUTE_ID >= 61 && $ROUTE_ID <= 90) zone = 'este';
              if ($ROUTE_ID >= 91 && $ROUTE_ID <= 120) zone = 'oeste';
              
              // Colores para zonas
              const zoneColors = {
                'norte': '#EF4444', // red-500
                'sur': '#3B82F6',   // blue-500
                'este': '#22C55E',  // green-500
                'oeste': '#A855F7', // purple-500
                'centro': '#F97316' // orange-500
              };
              
              // Generar nombre y color
              const routeName = 'Ruta $ROUTE_ID (Alternativa 2)';
              const shortName = 'R${ROUTE_ID}A2';
              const color = zoneColors[zone];
              
              // Verificar si ya existe
              const existingRoutes = await db.query.busRoutes.findMany({
                where: (busRoutes, { eq }) => eq(busRoutes.name, routeName)
              });
              
              if (existingRoutes.length > 0) {
                console.log('La ruta ' + routeName + ' ya existe en la base de datos, omitiendo...');
                process.exit(0);
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
              
              console.log('✅ Ruta creada: ' + routeName + ' (ID: ' + route.id + ') con ' + routeCoordinates.length + ' puntos');
              
              // Generar paradas automáticamente
              const totalStops = Math.min(
                Math.max(10, Math.floor(routeCoordinates.length / 50)),
                40 // máximo 40 paradas
              );
              
              let stopsCount = 0;
              
              // Terminal origen
              const firstCoord = routeCoordinates[0];
              await storage.createStop({
                routeId: route.id,
                name: 'Terminal Origen (R${ROUTE_ID})',
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
                    name: 'Parada ' + i,
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
                name: 'Terminal Destino (R${ROUTE_ID})',
                latitude: lastCoord[1].toString(),
                longitude: lastCoord[0].toString(),
                isTerminal: true,
                terminalType: 'last'
              });
              stopsCount++;
              
              // Actualizar contador de paradas en la ruta
              await storage.updateRoute(route.id, { stopsCount: stopsCount });
              
              console.log('✅ Creadas ' + stopsCount + ' paradas para la ruta ' + route.id);
              console.log(JSON.stringify({ routeId: route.id, stopsCount: stopsCount }));
              process.exit(0);
            } catch (error) {
              console.error('Error importando ruta:', error);
              process.exit(1);
            }
          }
          
          importRoute();
        "
        
        if [ $? -eq 0 ]; then
          echo "✅ Ruta alternativa 2 importada correctamente"
          ROUTES_IMPORTED=$((ROUTES_IMPORTED + 1))
          # Buscar el número de paradas creadas en la salida
          STOPS=$(grep -o "Creadas [0-9]* paradas" | grep -o "[0-9]*" || echo "0")
          STOPS_CREATED=$((STOPS_CREATED + STOPS))
        else
          echo "❌ Error al importar ruta alternativa 2"
          ERRORS=$((ERRORS + 1))
        fi
      else
        echo "❌ No se encontró archivo .shp en route.zip"
        ERRORS=$((ERRORS + 1))
      fi
    else
      echo "❌ No se encontró archivo route.zip en ruta_2"
      ERRORS=$((ERRORS + 1))
    fi
    
    # Limpiar directorio temporal
    rm -rf "$TMP_DIR"
  fi
  
  if [ ! -d "$ROUTE_DIR/ruta_1" ] && [ ! -d "$ROUTE_DIR/ruta_2" ]; then
    echo "⚠️ La ruta $ROUTE_ID no tiene subdirectorios ruta_1 o ruta_2"
    ERRORS=$((ERRORS + 1))
  fi
  
  echo "Procesado: $ROUTES_IMPORTED rutas, $STOPS_CREATED paradas, $ERRORS errores"
done

echo "=========================================="
echo "Resumen de importación de rutas alternativas:"
echo "- Rutas importadas: $ROUTES_IMPORTED"
echo "- Paradas creadas: $STOPS_CREATED"
echo "- Errores: $ERRORS"
echo "=========================================="