#!/bin/bash

# Script para importar una ruta específica desde un archivo GeoJSON
# Uso: bash scripts/import-geojson-route.sh <numero_ruta> <ruta_archivo_geojson>

if [ $# -ne 2 ]; then
  echo "Uso: bash scripts/import-geojson-route.sh <numero_ruta> <ruta_archivo_geojson>"
  exit 1
fi

ROUTE_ID=$1
GEOJSON_PATH=$2

echo "Iniciando importación de la Ruta $ROUTE_ID desde archivo GeoJSON: $GEOJSON_PATH..."

# Ejecutar script TypeScript para importar la ruta desde el GeoJSON
npx tsx scripts/import-from-geojson.ts $ROUTE_ID $GEOJSON_PATH

echo "¡Importación de la Ruta $ROUTE_ID completada!"