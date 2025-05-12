#!/bin/bash

# Script para importar todas las rutas restantes en lotes secuenciales
# Cada lote procesa 10 rutas

echo "===== IMPORTACIÓN MASIVA DE RUTAS Y PARADAS ====="
echo "Este script importará todas las rutas restantes en lotes de 10"

# Rango de rutas a importar (ajustar según sea necesario)
# Importamos todas las rutas secuencialmente sin saltar ninguna
START=1
END=120

# Importar en lotes de 10 rutas
BATCH_SIZE=10

for ((i=START; i<=END; i+=BATCH_SIZE))
do
  END_BATCH=$((i+BATCH_SIZE-1))
  if [ $END_BATCH -gt $END ]; then
    END_BATCH=$END
  fi
  
  echo ""
  echo "===== PROCESANDO LOTE DE RUTAS $i-$END_BATCH ====="
  echo ""
  
  # Ejecutar el script de importación para este lote
  tsx scripts/batch-import-routes.ts $i $END_BATCH
  
  # Pequeña pausa entre lotes para evitar sobrecarga
  echo "Esperando 5 segundos antes del siguiente lote..."
  sleep 5
done

echo ""
echo "===== IMPORTACIÓN MASIVA COMPLETADA ====="
echo "Se han procesado todas las rutas en el rango $START-$END"