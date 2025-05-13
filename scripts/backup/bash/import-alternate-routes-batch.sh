#!/bin/bash

# Script para importar rutas alternativas (34-44) usando el script de TypeScript

# Recibe parámetros para el rango de rutas
START_ROUTE=${1:-34}
END_ROUTE=${2:-44}

echo "Iniciando importación de rutas alternativas (estructura ruta_1/ruta_2) desde $START_ROUTE hasta $END_ROUTE"

# Ejecutar el script TypeScript que procesa las rutas alternativas
tsx scripts/process-alternate-routes.ts $START_ROUTE $END_ROUTE

echo "Finalizada importación de rutas alternativas $START_ROUTE a $END_ROUTE"