#!/bin/bash

# Script para importar paradas para una ruta específica
# Uso: bash scripts/import-stops.sh <id_ruta> <ruta_archivo_zip>

if [ $# -ne 2 ]; then
  echo "Uso: bash scripts/import-stops.sh <id_ruta> <ruta_archivo_zip>"
  exit 1
fi

ROUTE_ID=$1
ZIP_PATH=$2

echo "Iniciando importación de paradas para ruta $ROUTE_ID desde archivo: $ZIP_PATH..."

# Ejecutar script TypeScript para importar las paradas
npx tsx scripts/import-stops-from-file.ts $ROUTE_ID $ZIP_PATH

echo "¡Importación de paradas completada!"