#!/bin/bash

# Script para importar rutas en lotes pequeños
# Uso: bash scripts/import-routes-in-batches.sh <inicio> <fin> <tamaño_lote>

START_ROUTE=${1:-34}
END_ROUTE=${2:-120}
BATCH_SIZE=${3:-10}

echo "Iniciando importación de rutas desde $START_ROUTE hasta $END_ROUTE en lotes de $BATCH_SIZE"

# Verificamos qué rutas ya existen para evitar intentar reimportarlas
psql "$DATABASE_URL" -c "CREATE TEMP TABLE existing_routes AS SELECT CAST(REGEXP_REPLACE(name, '^Ruta (\d+).*$', '\1') AS INTEGER) as route_num FROM bus_routes WHERE name ~ '^Ruta \d+.*$';"
psql "$DATABASE_URL" -c "SELECT 'Rutas ya existentes:' AS info;"
psql "$DATABASE_URL" -c "SELECT route_num FROM existing_routes ORDER BY route_num;"

# Contadores para el seguimiento
TOTAL_ROUTES_IMPORTED=0
TOTAL_ROUTES_FAILED=0
TOTAL_STOPS_CREATED=0

# Procesamiento en lotes
current_start=$START_ROUTE
while [ $current_start -le $END_ROUTE ]; do
  current_end=$((current_start + BATCH_SIZE - 1))
  if [ $current_end -gt $END_ROUTE ]; then
    current_end=$END_ROUTE
  fi
  
  echo ""
  echo "=================================================="
  echo "Procesando lote de rutas $current_start a $current_end"
  echo "=================================================="
  
  # Para cada ruta en el lote, verificamos si ya existe
  for route_id in $(seq $current_start $current_end); do
    # Verificar si la ruta ya existe
    exists=$(psql "$DATABASE_URL" -t -c "SELECT 1 FROM existing_routes WHERE route_num = $route_id;")
    
    if [ -n "$exists" ]; then
      echo "Ruta $route_id ya existe, omitiendo..."
      continue
    fi
    
    echo "Importando ruta $route_id..."
    bash scripts/import-single-route.sh $route_id
    
    if [ $? -eq 0 ]; then
      echo "✅ Ruta $route_id importada con éxito"
      TOTAL_ROUTES_IMPORTED=$((TOTAL_ROUTES_IMPORTED + 1))
      
      # Actualizar contadores basados en la salida del script
      STOPS=$(grep -o "paradas creadas" | wc -l)
      TOTAL_STOPS_CREATED=$((TOTAL_STOPS_CREATED + STOPS))
    else
      echo "❌ Error al importar ruta $route_id"
      TOTAL_ROUTES_FAILED=$((TOTAL_ROUTES_FAILED + 1))
    fi
  done
  
  current_start=$((current_end + 1))
  echo "Progreso: $TOTAL_ROUTES_IMPORTED rutas importadas, $TOTAL_ROUTES_FAILED fallidas, $TOTAL_STOPS_CREATED paradas creadas"
done

echo ""
echo "=================================================="
echo "RESUMEN DE IMPORTACIÓN"
echo "- Rutas importadas: $TOTAL_ROUTES_IMPORTED"
echo "- Rutas fallidas: $TOTAL_ROUTES_FAILED"
echo "- Paradas creadas: $TOTAL_STOPS_CREATED"
echo "=================================================="

echo "Finalizada importación en lotes de rutas $START_ROUTE a $END_ROUTE"