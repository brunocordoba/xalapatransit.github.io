#!/bin/bash

# Este script importa todas las rutas en lotes secuenciales
# Los lotes son de 5 rutas para evitar tiempos de espera

START_ROUTE=1
END_ROUTE=120
BATCH_SIZE=5

echo "Iniciando importación secuencial de todas las rutas del $START_ROUTE al $END_ROUTE"
echo "Tamaño de lote: $BATCH_SIZE rutas por ejecución"

for ((start=$START_ROUTE; start<=$END_ROUTE; start+=$BATCH_SIZE)); do
  end=$((start + BATCH_SIZE - 1))
  
  # Asegurarnos de no exceder el límite final
  if [ $end -gt $END_ROUTE ]; then
    end=$END_ROUTE
  fi
  
  echo "-----------------------------------------------"
  echo "Procesando lote: Rutas $start a $end"
  echo "-----------------------------------------------"
  
  # Ejecutar el script para este lote
  bash scripts/import-routes-batch.sh $start $end
  
  # Verificar si hubo error
  if [ $? -ne 0 ]; then
    echo "Error procesando lote $start-$end"
    echo "Intente continuar manualmente desde la ruta $start"
    exit 1
  fi
  
  echo "Lote $start-$end completado correctamente"
  echo "Esperando 5 segundos antes del siguiente lote..."
  sleep 5
done

echo "¡Importación completa de todas las rutas!"