#!/bin/bash

# Script para importar rutas alternativas (34-44) una por una
# Usa tsx directamente para ejecutar TypeScript

# Recibe parámetros para el rango de rutas
START_ROUTE=${1:-34}
END_ROUTE=${2:-44}

echo "Iniciando importación de rutas alternativas (estructura ruta_1/ruta_2) desde $START_ROUTE hasta $END_ROUTE"

# Contadores
RUTAS_IMPORTADAS=0
RUTAS_FALLIDAS=0

for RUTA in $(seq $START_ROUTE $END_ROUTE); do
  echo ""
  echo "=================================================="
  echo "Procesando ruta $RUTA"
  echo "=================================================="
  
  # Verificar si existe el directorio de la ruta
  RUTA_DIR="./tmp/mapaton-extract/shapefiles-mapton-ciudadano/${RUTA}_circuito"
  
  if [ ! -d "$RUTA_DIR" ]; then
    echo "⚠️ No existe el directorio para la ruta $RUTA, omitiendo..."
    continue
  fi
  
  # Verificar si tiene subdirectorio ruta_1
  if [ -d "$RUTA_DIR/ruta_1" ]; then
    echo "Importando ruta $RUTA (alternativa 1)..."
    tsx scripts/importar-ruta-directamente.ts $RUTA 1
    
    if [ $? -eq 0 ]; then
      echo "✅ Ruta $RUTA (alternativa 1) importada con éxito"
      RUTAS_IMPORTADAS=$((RUTAS_IMPORTADAS + 1))
    else
      echo "❌ Error al importar ruta $RUTA (alternativa 1)"
      RUTAS_FALLIDAS=$((RUTAS_FALLIDAS + 1))
    fi
  fi
  
  # Verificar si tiene subdirectorio ruta_2
  if [ -d "$RUTA_DIR/ruta_2" ]; then
    echo "Importando ruta $RUTA (alternativa 2)..."
    tsx scripts/importar-ruta-directamente.ts $RUTA 2
    
    if [ $? -eq 0 ]; then
      echo "✅ Ruta $RUTA (alternativa 2) importada con éxito"
      RUTAS_IMPORTADAS=$((RUTAS_IMPORTADAS + 1))
    else
      echo "❌ Error al importar ruta $RUTA (alternativa 2)"
      RUTAS_FALLIDAS=$((RUTAS_FALLIDAS + 1))
    fi
  fi
  
  # Si no hay ninguno de los subdirectorios
  if [ ! -d "$RUTA_DIR/ruta_1" ] && [ ! -d "$RUTA_DIR/ruta_2" ]; then
    echo "⚠️ La ruta $RUTA no tiene subdirectorios ruta_1 o ruta_2"
    RUTAS_FALLIDAS=$((RUTAS_FALLIDAS + 1))
  fi
  
  echo "Progreso: $RUTAS_IMPORTADAS rutas importadas, $RUTAS_FALLIDAS errores"
done

echo ""
echo "=================================================="
echo "RESUMEN DE IMPORTACIÓN"
echo "- Rutas importadas: $RUTAS_IMPORTADAS"
echo "- Rutas fallidas: $RUTAS_FALLIDAS"
echo "=================================================="

echo "Finalizada importación de rutas alternativas $START_ROUTE a $END_ROUTE"