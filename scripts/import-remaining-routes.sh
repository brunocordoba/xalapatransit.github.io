#!/bin/bash

# Script para importar las rutas restantes (52-120)
# Omite las rutas con estructura especial (34-44)

START_ROUTE=${1:-52}
END_ROUTE=${2:-60}

echo "Iniciando importación de rutas desde $START_ROUTE hasta $END_ROUTE"

# Contadores para el seguimiento
TOTAL_ROUTES_IMPORTED=0
TOTAL_ROUTES_FAILED=0

for route_id in $(seq $START_ROUTE $END_ROUTE); do
  echo ""
  echo "=================================================="
  echo "Procesando ruta $route_id"
  echo "=================================================="
  
  # Verificar si la ruta ya existe en la base de datos
  ROUTE_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $route_id' OR name LIKE 'Ruta $route_id (%)';" | tr -d '[:space:]')
  
  if [ "$ROUTE_EXISTS" -gt "0" ]; then
    echo "Ruta $route_id ya existe en la base de datos, omitiendo..."
    continue
  fi
  
  # Importar la ruta
  echo "Importando ruta $route_id..."
  bash scripts/import-single-route.sh $route_id
  
  if [ $? -eq 0 ]; then
    echo "✅ Ruta $route_id importada con éxito"
    TOTAL_ROUTES_IMPORTED=$((TOTAL_ROUTES_IMPORTED + 1))
  else
    echo "❌ Error al importar ruta $route_id"
    TOTAL_ROUTES_FAILED=$((TOTAL_ROUTES_FAILED + 1))
  fi
  
  echo "Progreso: $TOTAL_ROUTES_IMPORTED rutas importadas, $TOTAL_ROUTES_FAILED fallidas"
done

echo ""
echo "=================================================="
echo "RESUMEN DE IMPORTACIÓN"
echo "- Rutas importadas: $TOTAL_ROUTES_IMPORTED"
echo "- Rutas fallidas: $TOTAL_ROUTES_FAILED"
echo "=================================================="

echo "Finalizada importación de rutas $START_ROUTE a $END_ROUTE"