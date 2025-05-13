#!/bin/bash

# Script para importar todas las rutas restantes en lotes pequeños
# Esto procesa los lotes secuencialmente para evitar interrupciones

echo "=== IMPORTANDO TODAS LAS RUTAS RESTANTES EN LOTES PEQUEÑOS ==="
echo "Este script importará las rutas pendientes hasta completar las 120 rutas."

# Verificamos las rutas que ya existen
echo "Verificando rutas existentes..."
EXISTING_ROUTES=$(psql "$DATABASE_URL" -t -c "SELECT CAST(REGEXP_REPLACE(name, '^Ruta (\d+).*$', '\1') AS INTEGER) as route_num FROM bus_routes WHERE name ~ '^Ruta \d+.*$' ORDER BY route_num;" | tr -d '[:space:]' | tr '\n' ',' | sed 's/,$//')
echo "Rutas ya existentes: $EXISTING_ROUTES"

# Definir lotes de importación (en rangos pequeños)
BATCHES=(
  "78 80"
  "81 83" 
  "84 86"
  "87 89"
  "90 92"
  "93 95"
  "96 98"
  "99 101"
  "102 104"
  "105 107"
  "108 110"
  "111 113"
  "114 116"
  "117 120"
)

# Procesar cada lote
for BATCH in "${BATCHES[@]}"; do
  read -r START_ID END_ID <<< "$BATCH"
  
  echo ""
  echo "======================================================"
  echo "Importando lote de rutas desde $START_ID hasta $END_ID"
  echo "======================================================"
  
  # Importar el lote
  bash scripts/import-batch.sh $START_ID $END_ID
  
  # Verificar progreso
  CURRENT_TOTAL=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes;" | tr -d '[:space:]')
  echo "Progreso global: $CURRENT_TOTAL rutas importadas en total"
  
  # Breve pausa entre lotes
  sleep 3
done

# Resumen final
FINAL_TOTAL=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes;" | tr -d '[:space:]')
FINAL_STOPS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_stops;" | tr -d '[:space:]')

echo ""
echo "======================================================"
echo "=== RESUMEN FINAL DE IMPORTACIÓN ==="
echo "- Total de rutas en la base de datos: $FINAL_TOTAL / 120"
echo "- Total de paradas en la base de datos: $FINAL_STOPS"
echo "- Porcentaje completado: $(( ($FINAL_TOTAL * 100) / 120 ))%"
echo "======================================================"