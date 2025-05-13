#!/bin/bash

# Script para importar todas las rutas faltantes sin generar paradas automáticas
# Uso: bash scripts/import-all-routes-no-stops.sh <inicio> <fin>

START_ROUTE=${1:-1}
END_ROUTE=${2:-120}
SKIP_EXISTING=true

echo "=== IMPORTANDO TODAS LAS RUTAS DESDE $START_ROUTE HASTA $END_ROUTE ==="
echo "Este script importará todas las rutas pendientes sin generar paradas automáticas."

# Verificamos las rutas que ya existen
echo "Verificando rutas existentes..."
EXISTING_ROUTES=$(psql "$DATABASE_URL" -t -c "SELECT CAST(REGEXP_REPLACE(name, '^Ruta (\d+).*$', '\1') AS INTEGER) as route_num FROM bus_routes WHERE name ~ '^Ruta \d+.*$' ORDER BY route_num;" | tr -d '[:space:]' | tr '\n' ',')
echo "Rutas ya existentes: $EXISTING_ROUTES"

# Contador para seguimiento
TOTAL_IMPORTED=0
TOTAL_FAILED=0

# Función para verificar si una ruta ya existe
route_exists() {
  local route_id=$1
  if [[ $EXISTING_ROUTES == *"$route_id"* ]]; then
    return 0  # Existe
  else
    return 1  # No existe
  fi
}

# Crear un script temporal que modifique sequential-import.ts para no generar paradas automáticas
cat > tmp_disable_auto_stops.sh << EOF
#!/bin/bash
# Modificar sequential-import.ts para no generar paradas automáticas
sed -i 's/await generateAutomaticStops/\/\/ await generateAutomaticStops/g' scripts/sequential-import.ts
EOF
chmod +x tmp_disable_auto_stops.sh
bash tmp_disable_auto_stops.sh
rm tmp_disable_auto_stops.sh

# Procesar todas las rutas en el rango
for ROUTE_ID in $(seq $START_ROUTE $END_ROUTE); do
  echo ""
  echo "=================================================="
  echo "Verificando ruta $ROUTE_ID"
  echo "=================================================="
  
  # Verificar si la ruta ya existe
  ROUTE_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID' OR name LIKE 'Ruta $ROUTE_ID (%)';" | tr -d '[:space:]')
  
  if [ "$ROUTE_EXISTS" -gt "0" ] && [ "$SKIP_EXISTING" = true ]; then
    echo "Ruta $ROUTE_ID ya existe en la base de datos, omitiendo..."
    continue
  fi
  
  # Importar la ruta
  echo "Importando ruta $ROUTE_ID..."
  bash scripts/import-single-route.sh $ROUTE_ID
  
  # Verificar resultado
  NEW_ROUTE_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes WHERE name = 'Ruta $ROUTE_ID' OR name LIKE 'Ruta $ROUTE_ID (%)';" | tr -d '[:space:]')
  
  if [ "$NEW_ROUTE_EXISTS" -gt "$ROUTE_EXISTS" ]; then
    echo "✅ Ruta $ROUTE_ID importada con éxito"
    TOTAL_IMPORTED=$((TOTAL_IMPORTED + 1))
  else
    echo "❌ Error al importar ruta $ROUTE_ID"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
  fi
  
  # Actualizar contador total
  CURRENT_TOTAL=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM bus_routes;" | tr -d '[:space:]')
  echo "Progreso: $TOTAL_IMPORTED rutas importadas, $TOTAL_FAILED fallidas (Total: $CURRENT_TOTAL rutas)"
done

# Restaurar sequential-import.ts
cat > tmp_enable_auto_stops.sh << EOF
#!/bin/bash
# Restaurar generateAutomaticStops en sequential-import.ts
sed -i 's/\/\/ await generateAutomaticStops/await generateAutomaticStops/g' scripts/sequential-import.ts
EOF
chmod +x tmp_enable_auto_stops.sh
bash tmp_enable_auto_stops.sh
rm tmp_enable_auto_stops.sh

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