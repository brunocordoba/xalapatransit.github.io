#!/bin/bash

echo "Importando datos de KML a la base de datos..."
npx tsx scripts/import-routes.ts
echo "Importación completada."