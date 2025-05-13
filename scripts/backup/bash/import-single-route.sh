#!/bin/bash

# Este script importa una sola ruta
# Uso: bash scripts/import-single-route.sh NUMERO_RUTA

# Verificar si se ha especificado una ruta
if [ -z "$1" ]; then
  echo "Error: No se especificó número de ruta."
  echo "Uso: bash scripts/import-single-route.sh NUMERO_RUTA"
  exit 1
fi

ROUTE_NUMBER=$1

echo "Iniciando importación de la Ruta $ROUTE_NUMBER..."
bash scripts/import-routes-batch.sh $ROUTE_NUMBER $ROUTE_NUMBER

if [ $? -ne 0 ]; then
  echo "Error procesando la Ruta $ROUTE_NUMBER"
  exit 1
fi

echo "¡Importación de la Ruta $ROUTE_NUMBER completada correctamente!"