#!/bin/bash

# Script para importar el siguiente lote de rutas
# Uso: ./import-next-batch.sh INICIO FIN
# Ejemplo: ./import-next-batch.sh 30 40

if [ $# -lt 2 ]; then
  echo "Uso: ./import-next-batch.sh INICIO FIN"
  echo "Ejemplo: ./import-next-batch.sh 30 40"
  exit 1
fi

START=$1
END=$2

echo "===== IMPORTACIÓN DE RUTAS $START-$END ====="
echo "Procesando lote de rutas..."

# Ejecutar el script de importación para este lote
tsx scripts/batch-import-routes.ts $START $END

echo ""
echo "===== IMPORTACIÓN COMPLETADA DEL LOTE $START-$END ====="
echo "Para continuar con el siguiente lote, ejecuta:"
echo "./import-next-batch.sh $((END+1)) $((END+10))"