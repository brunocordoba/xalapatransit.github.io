#!/bin/bash

# Script para agregar todas las rutas faltantes según su estructura
# Uso: bash scripts/agregar-todas-rutas-faltantes.sh

echo "=== AGREGANDO TODAS LAS RUTAS FALTANTES ==="
echo "Este script analizará e importará todas las rutas faltantes del 1 al 120"

# Obtener rutas ya existentes
echo "Verificando rutas existentes..."
EXISTING_ROUTES=$(psql "$DATABASE_URL" -t -c "SELECT CAST(REGEXP_REPLACE(name, '^Ruta (\d+).*$', '\1') AS INTEGER) as route_num FROM bus_routes WHERE name ~ '^Ruta \d+.*$' ORDER BY route_num;" | tr -d '[:space:]' | tr '\n' ',' | sed 's/,$//')
echo "Rutas ya existentes: $EXISTING_ROUTES"

# Contadores para seguimiento
TOTAL_IMPORTED=0
TOTAL_FAILED=0
TOTAL_SKIPPED=0

# Procesar rutas faltantes
for ROUTE_ID in $(seq 1 120); do
  # Verificar si la ruta ya existe
  if [[ $EXISTING_ROUTES == *"$ROUTE_ID"* ]]; then
    echo "Ruta $ROUTE_ID ya existe, omitiendo..."
    TOTAL_SKIPPED=$((TOTAL_SKIPPED + 1))
    continue
  fi
  
  echo ""
  echo "=================================================="
  echo "Procesando ruta $ROUTE_ID..."
  echo "=================================================="
  
  # Verificar estructura de carpetas
  CIRCUIT_DIR="./tmp/mapaton-extract/shapefiles-mapton-ciudadano/${ROUTE_ID}_circuito"
  ROUTE_DIR="./tmp/mapaton-extract/shapefiles-mapton-ciudadano/${ROUTE_ID}_ruta"
  
  # Verificar si tiene estructura alternativa (ruta_1, ruta_2)
  HAS_ALT_STRUCTURE=false
  if [ -d "$CIRCUIT_DIR/ruta_1" ] || [ -d "$CIRCUIT_DIR/ruta_2" ] || [ -d "$ROUTE_DIR/ruta_1" ] || [ -d "$ROUTE_DIR/ruta_2" ]; then
    HAS_ALT_STRUCTURE=true
    echo "Ruta $ROUTE_ID tiene estructura alternativa (ruta_1, ruta_2)"
  fi
  
  # Importar según estructura
  if [ "$HAS_ALT_STRUCTURE" = true ]; then
    echo "Importando ruta alternativa $ROUTE_ID..."
    
    # Importar ruta_1 si existe
    if [ -d "$CIRCUIT_DIR/ruta_1" ] || [ -d "$ROUTE_DIR/ruta_1" ]; then
      echo "Importando alternativa 1..."
      tsx scripts/importar-ruta-directamente.ts $ROUTE_ID 1
      
      # Verificar resultado
      ALT1_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID (Alternativa 1)';" | tr -d '[:space:]')
      
      if [ "$ALT1_EXISTS" -gt "0" ]; then
        echo "✅ Ruta $ROUTE_ID (Alternativa 1) importada con éxito"
        TOTAL_IMPORTED=$((TOTAL_IMPORTED + 1))
      else
        echo "❌ Error al importar ruta $ROUTE_ID (Alternativa 1)"
        TOTAL_FAILED=$((TOTAL_FAILED + 1))
      fi
    fi
    
    # Importar ruta_2 si existe
    if [ -d "$CIRCUIT_DIR/ruta_2" ] || [ -d "$ROUTE_DIR/ruta_2" ]; then
      echo "Importando alternativa 2..."
      tsx scripts/importar-ruta-directamente.ts $ROUTE_ID 2
      
      # Verificar resultado
      ALT2_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID (Alternativa 2)';" | tr -d '[:space:]')
      
      if [ "$ALT2_EXISTS" -gt "0" ]; then
        echo "✅ Ruta $ROUTE_ID (Alternativa 2) importada con éxito"
        TOTAL_IMPORTED=$((TOTAL_IMPORTED + 1))
      else
        echo "❌ Error al importar ruta $ROUTE_ID (Alternativa 2)"
        TOTAL_FAILED=$((TOTAL_FAILED + 1))
      fi
    fi
  else
    # Importar ruta normal
    echo "Importando ruta estándar $ROUTE_ID..."
    bash scripts/import-single-route.sh $ROUTE_ID
    
    # Verificar resultado
    ROUTE_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID' OR name LIKE 'Ruta $ROUTE_ID (%)';" | tr -d '[:space:]')
    
    if [ "$ROUTE_EXISTS" -gt "0" ]; then
      echo "✅ Ruta $ROUTE_ID importada con éxito"
      TOTAL_IMPORTED=$((TOTAL_IMPORTED + 1))
    else
      echo "❌ Error al importar ruta $ROUTE_ID"
      TOTAL_FAILED=$((TOTAL_FAILED + 1))
    fi
  fi
  
  # Mostrar progreso
  CURRENT_TOTAL=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes;" | tr -d '[:space:]')
  echo "Progreso: $TOTAL_IMPORTED rutas importadas, $TOTAL_FAILED fallidas, $TOTAL_SKIPPED omitidas (Total: $CURRENT_TOTAL rutas)"
  
  # Pausa entre rutas para evitar sobrecarga
  sleep 2
done

# Resumen final
echo ""
echo "=== RESUMEN DE IMPORTACIÓN ==="
FINAL_TOTAL=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes;" | tr -d '[:space:]')
FINAL_STOPS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_stops;" | tr -d '[:space:]')
echo "- Rutas importadas en esta ejecución: $TOTAL_IMPORTED"
echo "- Rutas fallidas: $TOTAL_FAILED"
echo "- Rutas omitidas (ya existentes): $TOTAL_SKIPPED"
echo "- Total de rutas en la base de datos: $FINAL_TOTAL"
echo "- Total de paradas en la base de datos: $FINAL_STOPS"
echo "=== IMPORTACIÓN COMPLETADA ==="