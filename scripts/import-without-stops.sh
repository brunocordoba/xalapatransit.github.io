#!/bin/bash

# Este script importa una ruta específica sin sus paradas
# Uso: bash import-without-stops.sh <numero_ruta>

# Verificar si se proporcionó un número de ruta
if [ -z "$1" ]; then
  echo "Error: Debes proporcionar un número de ruta."
  echo "Uso: bash import-without-stops.sh <numero_ruta>"
  exit 1
fi

ROUTE_ID=$1
BASE_DIR="./tmp/mapaton-extract/shapefiles-mapton-ciudadano"

# Determinar el directorio correcto (circuito o ruta)
if [ -d "$BASE_DIR/${ROUTE_ID}_circuito" ]; then
  ROUTE_DIR="${ROUTE_ID}_circuito"
elif [ -d "$BASE_DIR/${ROUTE_ID}_ruta" ]; then
  ROUTE_DIR="${ROUTE_ID}_ruta"
else
  echo "Error: No se encontró el directorio para la ruta $ROUTE_ID."
  exit 1
fi

echo "Iniciando importación de la Ruta $ROUTE_ID sin paradas..."
echo "Usando directorio: $BASE_DIR/$ROUTE_DIR"

# Verificar si existe archivo ZIP de ruta
ROUTE_ZIP="$BASE_DIR/$ROUTE_DIR/route.zip"
if [ -f "$ROUTE_ZIP" ]; then
  # Importar la ruta sin paradas
  npx tsx scripts/import-route-only.ts $ROUTE_ID "$ROUTE_ZIP"
else
  echo "Error: No se encontró el archivo de ruta en $ROUTE_ZIP"
  exit 1
fi

echo "¡Importación de la Ruta $ROUTE_ID completada!"