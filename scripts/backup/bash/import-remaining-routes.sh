#!/bin/bash

# Script para importar las rutas faltantes en lotes más pequeños
# Uso: bash scripts/import-remaining-routes.sh

echo "=== IMPORTANDO RUTAS FALTANTES ==="
echo "Este script importará todas las rutas pendientes en lotes pequeños"

# Verificamos las rutas que ya existen
echo "Verificando rutas existentes..."
EXISTING_ROUTES=$(psql "$DATABASE_URL" -t -c "SELECT CAST(REGEXP_REPLACE(name, '^Ruta (\d+).*$', '\1') AS INTEGER) as route_num FROM bus_routes WHERE name ~ '^Ruta \d+.*$' ORDER BY route_num;" | tr -d '[:space:]' | tr '\n' ',' | sed 's/,$//')
echo "Rutas ya existentes: $EXISTING_ROUTES"

# Modificar el script para desactivar la generación de paradas automáticas
echo "Modificando el script para importar sin paradas automáticas..."
sed -i 's/stopsCount = await generateAutomaticStops/\/\/ stopsCount = await generateAutomaticStops/g' scripts/sequential-import.ts

# Lista de todas las rutas
ALL_ROUTES=(1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 95 96 97 98 99 100 101 102 103 104 105 106 107 108 109 110 111 112 113 114 115 116 117 118 119 120)

# Contador para seguimiento
TOTAL_IMPORTED=0
TOTAL_FAILED=0

# Procesar las rutas faltantes uno por uno
for ROUTE_ID in "${ALL_ROUTES[@]}"; do
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
  echo "Progreso actual: $TOTAL_IMPORTED rutas importadas, $TOTAL_FAILED fallidas (Total: $CURRENT_TOTAL rutas)"
  
  # Pausa para evitar sobrecarga
  sleep 2
done

# Restaurar el script original
echo "Restaurando el script original..."
sed -i 's/\/\/ stopsCount = await generateAutomaticStops/stopsCount = await generateAutomaticStops/g' scripts/sequential-import.ts

# Resumen final
echo ""
echo "=== RESUMEN DE IMPORTACIÓN ==="
FINAL_TOTAL=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes;" | tr -d '[:space:]')
FINAL_STOPS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_stops;" | tr -d '[:space:]')
echo "- Rutas importadas: $TOTAL_IMPORTED"
echo "- Rutas fallidas: $TOTAL_FAILED"
echo "- Total de rutas en la base de datos: $FINAL_TOTAL"
echo "- Total de paradas en la base de datos: $FINAL_STOPS"
echo "=== IMPORTACIÓN COMPLETADA ==="