#!/bin/bash

# Script para añadir paradas manualmente a una ruta
# Uso: bash scripts/add-stops.sh <id_ruta>

if [ $# -ne 1 ]; then
  echo "Uso: bash scripts/add-stops.sh <id_ruta>"
  exit 1
fi

ROUTE_ID=$1

echo "Iniciando adición de paradas para ruta $ROUTE_ID..."

# Ejecutar script TypeScript para añadir paradas manualmente
npx tsx scripts/manually-add-stops.ts $ROUTE_ID

echo "¡Adición de paradas completada!"