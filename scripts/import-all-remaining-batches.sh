#!/bin/bash

# Script para ejecutar todos los lotes restantes de importación

# Batch 3
echo "Ejecutando lote 3..."
NODE_ENV=development tsx scripts/import-routes-batch-sequential.ts --batch=3

# Batch 4
echo "Ejecutando lote 4..."
NODE_ENV=development tsx scripts/import-routes-batch-sequential.ts --batch=4

# Batch 5
echo "Ejecutando lote 5..."
NODE_ENV=development tsx scripts/import-routes-batch-sequential.ts --batch=5

# Batch 6
echo "Ejecutando lote 6..."
NODE_ENV=development tsx scripts/import-routes-batch-sequential.ts --batch=6

# Batch 7
echo "Ejecutando lote 7..."
NODE_ENV=development tsx scripts/import-routes-batch-sequential.ts --batch=7

# Batch 8
echo "Ejecutando lote 8..."
NODE_ENV=development tsx scripts/import-routes-batch-sequential.ts --batch=8

# Batch 9
echo "Ejecutando lote 9..."
NODE_ENV=development tsx scripts/import-routes-batch-sequential.ts --batch=9

# Batch 10
echo "Ejecutando lote 10..."
NODE_ENV=development tsx scripts/import-routes-batch-sequential.ts --batch=10

# Batch 11
echo "Ejecutando lote 11..."
NODE_ENV=development tsx scripts/import-routes-batch-sequential.ts --batch=11

# Batch 12
echo "Ejecutando lote 12..."
NODE_ENV=development tsx scripts/import-routes-batch-sequential.ts --batch=12

# Batch 13
echo "Ejecutando lote 13..."
NODE_ENV=development tsx scripts/import-routes-batch-sequential.ts --batch=13

echo "Proceso completado. Todas las rutas han sido importadas."