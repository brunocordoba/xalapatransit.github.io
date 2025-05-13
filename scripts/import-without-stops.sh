#!/bin/bash

# Script para importar una ruta específica sin generar paradas automáticas
# Uso: bash scripts/import-without-stops.sh <numero_ruta>

if [ -z "$1" ]; then
  echo "Uso: bash scripts/import-without-stops.sh <numero_ruta>"
  exit 1
fi

ROUTE_ID=$1

echo "Iniciando importación de la Ruta $ROUTE_ID sin paradas automáticas..."

# Ejecutar script TypeScript para importar la ruta sin generar paradas automáticas
npx tsx scripts/import-route-without-stops.ts $ROUTE_ID

echo "¡Importación de la Ruta $ROUTE_ID completada!"