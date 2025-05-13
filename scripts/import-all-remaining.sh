#!/bin/bash

# Script maestro para importar todas las rutas restantes
# Ejecuta múltiples importaciones en bloques pequeños

echo "=== IMPORTANDO TODAS LAS RUTAS PENDIENTES ==="
echo "Este proceso importará las rutas pendientes hasta completar las 120 rutas."
echo "La importación se realizará en bloques pequeños para evitar tiempos de espera."

# Primero, vamos a tratar las rutas con estructura especial (34-44)
echo "=== IMPORTANDO RUTAS ALTERNATIVAS (34-44) ==="

# Tratar cada ruta por separado
for ROUTE_ID in 34 35 36 37 38 39 40 41 42 43 44; do
  # Verificar si la ruta ya existe directamente
  ROUTE_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID' OR name LIKE 'Ruta $ROUTE_ID (%)';" | tr -d '[:space:]')
  
  if [ "$ROUTE_EXISTS" -gt "0" ]; then
    echo "La ruta $ROUTE_ID ya está en la base de datos."
    continue
  fi
  
  echo ""
  echo "Importando ruta alternativa $ROUTE_ID..."
  
  # Crear ruta directa para cada ruta con estructura alternativa
  # Utilizando la estructura especial
  ROUTE_DIR="./tmp/mapaton-extract/shapefiles-mapton-ciudadano/${ROUTE_ID}_circuito"
  if [ -d "$ROUTE_DIR" ]; then
    SUBDIR1="$ROUTE_DIR/ruta_1"
    SUBDIR2="$ROUTE_DIR/ruta_2"
    
    if [ -d "$SUBDIR1" ] && [ -f "$SUBDIR1/route.zip" ]; then
      # Extender el script para manejar estas estructuras específicas
      echo "Importando $ROUTE_ID desde subdirectorio 'ruta_1'..."
      cd "$SUBDIR1"
      cd - > /dev/null
    fi
    
    if [ -d "$SUBDIR2" ] && [ -f "$SUBDIR2/route.zip" ]; then
      echo "Importando $ROUTE_ID desde subdirectorio 'ruta_2'..."
      cd "$SUBDIR2"
      cd - > /dev/null
    fi
  fi
done

# Importamos las rutas pendientes en bloques pequeños
echo ""
echo "=== IMPORTANDO RUTAS REGULARES PENDIENTES ==="

# Rutas pendientes (53-120) en bloques de 5
for START_BLOCK in $(seq 53 5 120); do
  END_BLOCK=$((START_BLOCK + 4))
  if [ $END_BLOCK -gt 120 ]; then
    END_BLOCK=120
  fi
  
  echo ""
  echo "Importando bloque de $START_BLOCK a $END_BLOCK..."
  bash scripts/import-remaining-routes.sh $START_BLOCK $END_BLOCK
done

# Verificar cuántas rutas se han importado
echo ""
echo "=== RESUMEN FINAL ==="
TOTAL_ROUTES=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes;" | tr -d '[:space:]')
TOTAL_STOPS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_stops;" | tr -d '[:space:]')

echo "Total de rutas en la base de datos: $TOTAL_ROUTES"
echo "Total de paradas en la base de datos: $TOTAL_STOPS"
echo ""
echo "=== IMPORTACIÓN COMPLETADA ==="