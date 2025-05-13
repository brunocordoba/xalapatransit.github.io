#!/bin/bash

# Script para importar rutas con estructura alterna (rutas 34-44)
# Uso: bash scripts/importar-rutas-alternas.sh <inicio> <fin>

START_ROUTE=${1:-34}
END_ROUTE=${2:-44}

echo "=== IMPORTANDO RUTAS ALTERNAS DESDE $START_ROUTE HASTA $END_ROUTE ==="
echo "Este script importará rutas con estructura alterna (ruta_1, ruta_2)"

# Contador para seguimiento
TOTAL_IMPORTED=0
TOTAL_FAILED=0

# Procesar cada ruta en el rango
for ROUTE_ID in $(seq $START_ROUTE $END_ROUTE); do
  echo ""
  echo "=================================================="
  echo "Importando ruta alterna $ROUTE_ID..."
  echo "=================================================="
  
  # Verificar existencia en base de datos
  ROUTE_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID' OR name LIKE 'Ruta $ROUTE_ID (%)';" | tr -d '[:space:]')
  
  if [ "$ROUTE_EXISTS" -gt "0" ]; then
    echo "Ruta $ROUTE_ID ya existe en la base de datos, omitiendo..."
    continue
  fi
  
  # Ejecutar script para importar ruta alterna
  echo "Ejecutando importación alterna para ruta $ROUTE_ID..."
  tsx scripts/importar-ruta-directamente.ts $ROUTE_ID 1
  
  # Verificar si se importó la primera alternativa
  ALT1_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID (Alternativa 1)';" | tr -d '[:space:]')
  
  if [ "$ALT1_EXISTS" -gt "0" ]; then
    echo "✅ Ruta $ROUTE_ID (Alternativa 1) importada con éxito"
    TOTAL_IMPORTED=$((TOTAL_IMPORTED + 1))
  else
    echo "❌ Error al importar ruta $ROUTE_ID (Alternativa 1)"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
  fi
  
  # Importar segunda alternativa
  echo "Ejecutando importación alterna 2 para ruta $ROUTE_ID..."
  tsx scripts/importar-ruta-directamente.ts $ROUTE_ID 2
  
  # Verificar si se importó la segunda alternativa
  ALT2_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID (Alternativa 2)';" | tr -d '[:space:]')
  
  if [ "$ALT2_EXISTS" -gt "0" ]; then
    echo "✅ Ruta $ROUTE_ID (Alternativa 2) importada con éxito"
    TOTAL_IMPORTED=$((TOTAL_IMPORTED + 1))
  else
    echo "❌ Error al importar ruta $ROUTE_ID (Alternativa 2)"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
  fi
  
  # Mostrar progreso
  CURRENT_TOTAL=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes;" | tr -d '[:space:]')
  echo "Progreso actual: $TOTAL_IMPORTED rutas importadas, $TOTAL_FAILED fallidas (Total: $CURRENT_TOTAL rutas)"
  
  # Pausa para evitar sobrecarga
  sleep 2
done

# Resumen final
echo ""
echo "=== RESUMEN DE IMPORTACIÓN DE RUTAS ALTERNAS ==="
FINAL_TOTAL=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes;" | tr -d '[:space:]')
echo "- Rutas importadas: $TOTAL_IMPORTED"
echo "- Rutas fallidas: $TOTAL_FAILED"
echo "- Total de rutas en la base de datos: $FINAL_TOTAL"
echo "=== IMPORTACIÓN COMPLETADA ==="