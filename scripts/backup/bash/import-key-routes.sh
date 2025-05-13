#!/bin/bash

# Script para importar rutas clave adicionales para demostración
# Seleccionamos algunas rutas representativas para complementar las ya existentes

# Lista de rutas clave a importar (una de cada decena)
KEY_ROUTES=(60 70 80 90 100 110 120)

echo "=== IMPORTANDO RUTAS CLAVE PARA DEMOSTRACIÓN ==="
echo "Este script importará rutas clave adicionales para complementar las ya existentes."

TOTAL_IMPORTED=0
TOTAL_FAILED=0

for ROUTE_ID in "${KEY_ROUTES[@]}"; do
  echo ""
  echo "=================================================="
  echo "Procesando ruta clave $ROUTE_ID"
  echo "=================================================="
  
  # Verificar si la ruta ya existe
  ROUTE_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID' OR name LIKE 'Ruta $ROUTE_ID (%)';" | tr -d '[:space:]')
  
  if [ "$ROUTE_EXISTS" -gt "0" ]; then
    echo "Ruta $ROUTE_ID ya existe en la base de datos, omitiendo..."
    continue
  fi
  
  # Importar la ruta
  echo "Importando ruta $ROUTE_ID..."
  bash scripts/import-single-route.sh $ROUTE_ID
  
  if [ $? -eq 0 ]; then
    echo "✅ Ruta $ROUTE_ID importada con éxito"
    TOTAL_IMPORTED=$((TOTAL_IMPORTED + 1))
  else
    echo "❌ Error al importar ruta $ROUTE_ID"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
  fi
  
  # Actualizar contadores
  TOTAL_ROUTES=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes;" | tr -d '[:space:]')
  TOTAL_STOPS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_stops;" | tr -d '[:space:]')
  
  echo "Progreso: $TOTAL_IMPORTED/$((TOTAL_IMPORTED + TOTAL_FAILED)) rutas importadas"
  echo "Total en base de datos: $TOTAL_ROUTES rutas, $TOTAL_STOPS paradas"
done

echo ""
echo "=== RESUMEN DE IMPORTACIÓN ==="
echo "- Rutas clave importadas: $TOTAL_IMPORTED"
echo "- Rutas fallidas: $TOTAL_FAILED"
echo "Total final: $TOTAL_ROUTES rutas en la base de datos"
echo "=== IMPORTACIÓN COMPLETADA ==="