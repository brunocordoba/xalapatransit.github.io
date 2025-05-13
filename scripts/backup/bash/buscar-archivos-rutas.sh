#!/bin/bash

# Este script busca archivos de ruta en los directorios
BASE_DIR="./tmp/mapaton-extract/shapefiles-mapton-ciudadano"

echo "Buscando archivos de ruta en todas las carpetas..."

for i in $(seq 1 120); do
  CIRCUIT_DIR="${BASE_DIR}/${i}_circuito"
  ROUTE_DIR="${BASE_DIR}/${i}_ruta"
  
  echo "===== Ruta $i ====="
  
  # Verificar directorio de circuito
  if [ -d "$CIRCUIT_DIR" ]; then
    echo "Directorio ${i}_circuito existe"
    
    # Verificar archivo route.zip en directorio principal
    if [ -f "$CIRCUIT_DIR/route.zip" ]; then
      echo "✓ Archivo route.zip encontrado"
    else
      echo "✗ No se encontró route.zip"
    fi
    
    # Verificar carpetas ida/vuelta
    if [ -d "$CIRCUIT_DIR/ida" ]; then
      echo "✓ Carpeta ida encontrada"
      if [ -f "$CIRCUIT_DIR/ida/route.zip" ]; then
        echo "  ✓ Archivo ida/route.zip encontrado"
      else
        echo "  ✗ No se encontró ida/route.zip"
      fi
    else
      echo "✗ No se encontró carpeta ida"
    fi
    
    if [ -d "$CIRCUIT_DIR/vuelta" ]; then
      echo "✓ Carpeta vuelta encontrada"
      if [ -f "$CIRCUIT_DIR/vuelta/route.zip" ]; then
        echo "  ✓ Archivo vuelta/route.zip encontrado"
      else
        echo "  ✗ No se encontró vuelta/route.zip"
      fi
    else
      echo "✗ No se encontró carpeta vuelta"
    fi
    
    # Verificar carpetas ruta_1, ruta_2 (alternativas)
    if [ -d "$CIRCUIT_DIR/ruta_1" ]; then
      echo "✓ Carpeta ruta_1 encontrada"
      if [ -f "$CIRCUIT_DIR/ruta_1/route.zip" ]; then
        echo "  ✓ Archivo ruta_1/route.zip encontrado"
      else
        echo "  ✗ No se encontró ruta_1/route.zip"
      fi
    fi
    
    if [ -d "$CIRCUIT_DIR/ruta_2" ]; then
      echo "✓ Carpeta ruta_2 encontrada"
      if [ -f "$CIRCUIT_DIR/ruta_2/route.zip" ]; then
        echo "  ✓ Archivo ruta_2/route.zip encontrado"
      else
        echo "  ✗ No se encontró ruta_2/route.zip"
      fi
    fi
  else
    echo "✗ No existe directorio ${i}_circuito"
  fi
  
  # Verificar directorio de ruta
  if [ -d "$ROUTE_DIR" ]; then
    echo "Directorio ${i}_ruta existe"
    
    # Verificar archivo route.zip en directorio principal
    if [ -f "$ROUTE_DIR/route.zip" ]; then
      echo "✓ Archivo route.zip encontrado"
    else
      echo "✗ No se encontró route.zip"
    fi
    
    # Verificar carpetas ida/vuelta
    if [ -d "$ROUTE_DIR/ida" ]; then
      echo "✓ Carpeta ida encontrada"
      if [ -f "$ROUTE_DIR/ida/route.zip" ]; then
        echo "  ✓ Archivo ida/route.zip encontrado"
      else
        echo "  ✗ No se encontró ida/route.zip"
      fi
    else
      echo "✗ No se encontró carpeta ida"
    fi
    
    if [ -d "$ROUTE_DIR/vuelta" ]; then
      echo "✓ Carpeta vuelta encontrada"
      if [ -f "$ROUTE_DIR/vuelta/route.zip" ]; then
        echo "  ✓ Archivo vuelta/route.zip encontrado"
      else
        echo "  ✗ No se encontró vuelta/route.zip"
      fi
    else
      echo "✗ No se encontró carpeta vuelta"
    fi
    
    # Verificar carpetas ruta_1, ruta_2 (alternativas)
    if [ -d "$ROUTE_DIR/ruta_1" ]; then
      echo "✓ Carpeta ruta_1 encontrada"
      if [ -f "$ROUTE_DIR/ruta_1/route.zip" ]; then
        echo "  ✓ Archivo ruta_1/route.zip encontrado"
      else
        echo "  ✗ No se encontró ruta_1/route.zip"
      fi
    fi
    
    if [ -d "$ROUTE_DIR/ruta_2" ]; then
      echo "✓ Carpeta ruta_2 encontrada"
      if [ -f "$ROUTE_DIR/ruta_2/route.zip" ]; then
        echo "  ✓ Archivo ruta_2/route.zip encontrado"
      else
        echo "  ✗ No se encontró ruta_2/route.zip"
      fi
    fi
  else
    echo "✗ No existe directorio ${i}_ruta"
  fi
  
  echo "" # Línea en blanco para separar
done