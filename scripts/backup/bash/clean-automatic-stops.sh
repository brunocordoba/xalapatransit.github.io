#!/bin/bash

# Script para eliminar las paradas generadas automáticamente
# Uso: bash scripts/clean-automatic-stops.sh

echo "Iniciando eliminación de paradas generadas automáticamente..."

# Ejecutar script TypeScript para eliminar paradas automáticas
npx tsx scripts/remove-automatic-stops.ts

echo "¡Limpieza completada!"