#!/bin/bash

echo "Importando datos de KML a la base de datos..."
npx tsx scripts/import-kml.ts
echo "Importación completada."