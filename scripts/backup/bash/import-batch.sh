#!/bin/bash

# Script para importar un lote de rutas
# Uso: bash scripts/import-batch.sh <start_id> <end_id>

START_ID=${1:-75}
END_ID=${2:-85}

echo "Iniciando importación de rutas desde $START_ID hasta $END_ID..."

# Verificamos las rutas que ya existen
echo "Verificando rutas existentes..."
EXISTING_ROUTES=$(psql "$DATABASE_URL" -t -c "SELECT CAST(REGEXP_REPLACE(name, '^Ruta (\d+).*$', '\1') AS INTEGER) as route_num FROM bus_routes WHERE name ~ '^Ruta \d+.*$' ORDER BY route_num;" | tr -d '[:space:]' | tr '\n' ',' | sed 's/,$//')
echo "Rutas ya existentes: $EXISTING_ROUTES"

# Contador para seguimiento
TOTAL_IMPORTED=0
TOTAL_FAILED=0

# Importar cada ruta en el rango
for ROUTE_ID in $(seq $START_ID $END_ID); do
  # Verificar si la ruta ya existe
  if [[ "$EXISTING_ROUTES" == *"$ROUTE_ID"* ]]; then
    echo "Ruta $ROUTE_ID ya existe, omitiendo..."
    continue
  fi
  
  echo ""
  echo "=================================================="
  echo "Importando ruta $ROUTE_ID..."
  echo "=================================================="
  
  # Importar la ruta usando el script individual
  bash scripts/import-single-route.sh $ROUTE_ID
  
  # Verificar resultado
  NEW_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID' OR name LIKE 'Ruta $ROUTE_ID (%)';" | tr -d '[:space:]')
  
  if [ "$NEW_EXISTS" -gt "0" ]; then
    echo "✅ Ruta $ROUTE_ID importada con éxito"
    TOTAL_IMPORTED=$((TOTAL_IMPORTED + 1))
  else
    echo "❌ Error al importar ruta $ROUTE_ID"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
  fi
  
  # Mostrar progreso
  CURRENT_TOTAL=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes;" | tr -d '[:space:]')
  echo "Progreso actual: $CURRENT_TOTAL rutas en total ($TOTAL_IMPORTED importadas en este lote, $TOTAL_FAILED fallidas)"
  
  # Pausa para evitar sobrecarga
  sleep 2
done

# Resumen final
echo ""
echo "=== RESUMEN DE IMPORTACIÓN DEL LOTE $START_ID-$END_ID ==="
FINAL_TOTAL=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes;" | tr -d '[:space:]')
FINAL_STOPS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_stops;" | tr -d '[:space:]')
echo "- Rutas importadas en este lote: $TOTAL_IMPORTED"
echo "- Rutas fallidas en este lote: $TOTAL_FAILED"
echo "- Total de rutas en la base de datos: $FINAL_TOTAL"
echo "- Total de paradas en la base de datos: $FINAL_STOPS"
echo "=== IMPORTACIÓN DEL LOTE COMPLETADA ==="