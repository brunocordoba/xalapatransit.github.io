#!/bin/bash

# Script para importar una ruta con estructura especial
# Uso: bash scripts/import-special-route.sh <numero_ruta> <tipo_estructura>

ROUTE_ID=${1:-68}
STRUCTURE=${2:-"circuito"}

echo "=== IMPORTANDO RUTA ESPECIAL $ROUTE_ID ($STRUCTURE) ==="

# Estructura específica para la ruta 68 con archivos en subdirectorio routes
if [ "$ROUTE_ID" = "68" ] && [ "$STRUCTURE" = "circuito" ]; then
  BASE_DIR="./tmp/mapaton-extract/shapefiles-mapton-ciudadano/${ROUTE_ID}_${STRUCTURE}"
  
  if [ ! -d "$BASE_DIR" ]; then
    echo "❌ Error: No se encontró el directorio $BASE_DIR"
    exit 1
  fi
  
  ROUTES_DIR="$BASE_DIR/routes"
  STOPS_DIR="$BASE_DIR/stops"
  
  if [ ! -d "$ROUTES_DIR" ]; then
    echo "❌ Error: No se encontró el directorio de rutas $ROUTES_DIR"
    exit 1
  fi
  
  # Verificar si la ruta ya existe
  ROUTE_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID';" | tr -d '[:space:]')
  
  if [ "$ROUTE_EXISTS" -gt "0" ]; then
    echo "⚠️ La ruta $ROUTE_ID ya existe en la base de datos"
    exit 0
  fi
  
  # Copiar archivos a un directorio temporal para procesarlos
  TEMP_DIR="./tmp/temp_route_$ROUTE_ID"
  mkdir -p "$TEMP_DIR"
  
  # Copiar archivos de ruta
  echo "Copiando archivos de ruta..."
  cp "$ROUTES_DIR/cto-1.1.zip" "$TEMP_DIR/route.zip"
  
  # Copiar archivos de paradas si existen
  if [ -d "$STOPS_DIR" ]; then
    echo "Copiando archivos de paradas..."
    find "$STOPS_DIR" -name "*.zip" -exec cp {} "$TEMP_DIR/stops.zip" \;
  fi
  
  # Crear directorio temporal con estructura estándar
  STANDARD_DIR="./tmp/temp_standard_$ROUTE_ID"
  mkdir -p "$STANDARD_DIR"
  cp -r "$TEMP_DIR/"* "$STANDARD_DIR/"
  
  # Usar el script de importación regular
  echo "Importando ruta $ROUTE_ID desde archivos preparados..."
  ORIG_PWD=$(pwd)
  cd "$STANDARD_DIR"
  tsx "$ORIG_PWD/scripts/sequential-import.ts" "$ROUTE_ID" "directa"
  cd "$ORIG_PWD"
  
  # Limpiar directorios temporales
  rm -rf "$TEMP_DIR"
  rm -rf "$STANDARD_DIR"
  
  # Verificar resultado
  NEW_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID';" | tr -d '[:space:]')
  
  if [ "$NEW_EXISTS" -gt "0" ]; then
    echo "✅ Ruta $ROUTE_ID importada con éxito"
  else
    echo "❌ Error al importar ruta $ROUTE_ID"
  fi
else
  echo "❌ Error: Esta estructura especial solo funciona para la ruta 68 con estructura 'circuito'"
  exit 1
fi