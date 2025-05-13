#!/bin/bash

# Script para importar paradas al estilo original
# Uso: bash scripts/original-import.sh <id_ruta>

if [ $# -ne 1 ]; then
  echo "Uso: bash scripts/original-import.sh <id_ruta>"
  exit 1
fi

ROUTE_ID=$1

echo "Iniciando importación original de paradas para ruta $ROUTE_ID..."

# Ejecutar script TypeScript para importar las paradas
npx tsx scripts/original-import-stops.ts $ROUTE_ID

echo "¡Importación de paradas completada!"