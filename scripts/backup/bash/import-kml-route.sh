#!/bin/bash

# Script para importar una ruta específica desde un archivo KML
# Uso: bash scripts/import-kml-route.sh <numero_ruta> <ruta_archivo_kml>

if [ $# -ne 2 ]; then
  echo "Uso: bash scripts/import-kml-route.sh <numero_ruta> <ruta_archivo_kml>"
  exit 1
fi

ROUTE_ID=$1
KML_PATH=$2

echo "Iniciando importación de la Ruta $ROUTE_ID desde archivo KML: $KML_PATH..."

# Ejecutar script TypeScript para importar la ruta desde el KML
npx tsx scripts/import-using-kml.ts $ROUTE_ID $KML_PATH

echo "¡Importación de la Ruta $ROUTE_ID completada!"