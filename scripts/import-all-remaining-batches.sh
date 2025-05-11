#!/bin/bash

# Script para importar automáticamente todos los lotes restantes
# Uso: ./scripts/import-all-remaining-batches.sh [lote-inicial] [lote-final]

# Valores predeterminados
START_BATCH=${1:-3}
END_BATCH=${2:-10}

echo "Comenzando importación automática de lotes $START_BATCH a $END_BATCH..."

for ((batch=START_BATCH; batch<=END_BATCH; batch++))
do
   echo "======================================="
   echo "Procesando lote $batch/$END_BATCH"
   echo "======================================="
   
   NODE_ENV=development tsx scripts/import-all-route-files.ts --batch=$batch
   
   # Verificar si el comando fue exitoso
   if [ $? -ne 0 ]; then
      echo "Error en el lote $batch. Deteniendo proceso."
      exit 1
   fi
   
   # Pequeña pausa entre lotes para evitar sobrecarga
   sleep 2
done

echo "¡Importación de todos los lotes completada con éxito!"
echo "Las 150 rutas de Mapaton Xalapa han sido importadas."