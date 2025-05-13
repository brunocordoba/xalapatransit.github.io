#!/bin/bash

# Script para procesar todas las rutas en bloques más pequeños
# Rango total: 568-711

echo "Iniciando procesamiento de todas las rutas en bloques..."

# Bloque 1: 568-590
echo "Procesando bloque 1 (568-590)..."
NODE_ENV=development tsx scripts/process-routes-batch.ts 568 590
echo "Bloque 1 completado."

# Bloque 2: 591-610
echo "Procesando bloque 2 (591-610)..."
NODE_ENV=development tsx scripts/process-routes-batch.ts 591 610
echo "Bloque 2 completado."

# Bloque 3: 611-630
echo "Procesando bloque 3 (611-630)..."
NODE_ENV=development tsx scripts/process-routes-batch.ts 611 630
echo "Bloque 3 completado."

# Bloque 4: 631-650
echo "Procesando bloque 4 (631-650)..."
NODE_ENV=development tsx scripts/process-routes-batch.ts 631 650
echo "Bloque 4 completado."

# Bloque 5: 651-670
echo "Procesando bloque 5 (651-670)..."
NODE_ENV=development tsx scripts/process-routes-batch.ts 651 670
echo "Bloque 5 completado."

# Bloque 6: 671-690
echo "Procesando bloque 6 (671-690)..."
NODE_ENV=development tsx scripts/process-routes-batch.ts 671 690
echo "Bloque 6 completado."

# Bloque 7: 691-711
echo "Procesando bloque 7 (691-711)..."
NODE_ENV=development tsx scripts/process-routes-batch.ts 691 711
echo "Bloque 7 completado."

echo "Procesamiento de todas las rutas completado."