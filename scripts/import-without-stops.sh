#!/bin/bash

# Script para importar una ruta sin paradas
# Uso: bash scripts/import-without-stops.sh <numero_ruta>

if [ -z "$1" ]; then
  echo "Uso: bash scripts/import-without-stops.sh <numero_ruta>"
  exit 1
fi

ROUTE_ID=$1

echo "Iniciando importación de la Ruta $ROUTE_ID sin paradas..."

# Construir la ruta al directorio
ROUTE_DIR="./tmp/mapaton-extract/shapefiles-mapton-ciudadano/${ROUTE_ID}_circuito"

if [ ! -d "$ROUTE_DIR" ]; then
  ROUTE_DIR="./tmp/mapaton-extract/shapefiles-mapton-ciudadano/${ROUTE_ID}_ruta"
  
  if [ ! -d "$ROUTE_DIR" ]; then
    echo "No se encontró el directorio para la ruta $ROUTE_ID"
    exit 1
  fi
fi

echo "Usando directorio: $ROUTE_DIR"

# Buscar archivo route.zip
ROUTE_ZIP="$ROUTE_DIR/route.zip"

if [ ! -f "$ROUTE_ZIP" ]; then
  echo "No se encontró el archivo route.zip en $ROUTE_DIR"
  exit 1
fi

# Importar la ruta sin paradas
npx tsx scripts/import-route-only.ts $ROUTE_ID $ROUTE_ZIP

echo "¡Importación de la Ruta $ROUTE_ID completada!"