#!/bin/bash

# Script para importar una ruta alternativa específica
# Uso: bash scripts/import-alternate-route.sh <numero_ruta> <numero_alternativa>

ROUTE_ID=${1:-34}
ALT_NUM=${2:-2}

echo "=== IMPORTANDO RUTA $ROUTE_ID ALTERNATIVA $ALT_NUM ==="

BASE_DIR="./tmp/mapaton-extract/shapefiles-mapton-ciudadano/${ROUTE_ID}_circuito/ruta_${ALT_NUM}"

if [ ! -d "$BASE_DIR" ]; then
  echo "❌ Error: No se encontró el directorio $BASE_DIR"
  exit 1
fi

if [ ! -f "$BASE_DIR/route.zip" ]; then
  echo "❌ Error: No se encontró el archivo route.zip en $BASE_DIR"
  exit 1
fi

# Verificar si la ruta ya existe
ROUTE_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID (Alternativa $ALT_NUM)';" | tr -d '[:space:]')

if [ "$ROUTE_EXISTS" -gt "0" ]; then
  echo "⚠️ La ruta $ROUTE_ID alternativa $ALT_NUM ya existe en la base de datos"
  exit 0
fi

# Ejecutar la importación
echo "Procesando ruta $ROUTE_ID alternativa $ALT_NUM..."
tsx scripts/import-alternate-route.ts $ROUTE_ID $ALT_NUM

# Verificar resultado
NEW_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID (Alternativa $ALT_NUM)';" | tr -d '[:space:]')

if [ "$NEW_EXISTS" -gt "0" ]; then
  echo "✅ Ruta $ROUTE_ID alternativa $ALT_NUM importada con éxito"
else
  echo "❌ Error al importar ruta $ROUTE_ID alternativa $ALT_NUM"
fi