#!/usr/bin/env python3
import os
import sys
import json
import shutil
import zipfile
import tempfile
import subprocess
from pathlib import Path

# Rutas
SHAPEFILES_DIR = './tmp/extracted/shapefiles-mapton-ciudadano'
OUTPUT_DIR = './tmp/geojson_routes'

# Asegurar que el directorio de salida exista
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Colores para las zonas
zone_colors = {
    'norte': '#EF4444',  # red-500
    'sur': '#3B82F6',    # blue-500
    'este': '#22C55E',   # green-500
    'oeste': '#A855F7',  # purple-500
    'centro': '#F97316'  # orange-500
}

# Determinar zona basada en ID de ruta
def determine_zone(route_id):
    route_id = int(route_id)
    if route_id < 20:
        return 'centro'
    elif route_id < 40:
        return 'norte'
    elif route_id < 60:
        return 'sur'
    elif route_id < 80:
        return 'este'
    else:
        return 'oeste'

# Procesar un zip de shapefile
def process_shapefile_zip(zip_path, output_dir):
    route_id = None
    # Extraer ID de la ruta del nombre del archivo
    path_parts = zip_path.split('/')
    for part in path_parts:
        if '_circuito' in part:
            route_id = part.split('_')[0]
            break
    
    if not route_id:
        print(f"No se pudo extraer route_id de {zip_path}")
        return None
    
    # Crear directorio temporal para extraer el shapefile
    with tempfile.TemporaryDirectory() as temp_dir:
        # Extraer el zip
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)
        
        # Buscar archivos .shp
        shp_files = list(Path(temp_dir).glob('**/*.shp'))
        if not shp_files:
            print(f"No se encontraron archivos .shp en {zip_path}")
            return None
        
        # Tomar el primer archivo .shp
        shp_file = str(shp_files[0])
        
        # Nombre para el archivo GeoJSON de salida
        output_file = os.path.join(output_dir, f"route_{route_id}.geojson")
        
        # Convertir shapefile a GeoJSON usando ogr2ogr (si está disponible)
        try:
            # Intentar usar ogr2ogr si está instalado
            subprocess.run(['ogr2ogr', '-f', 'GeoJSON', output_file, shp_file], 
                          check=True, capture_output=True)
            print(f"Convertido {shp_file} a {output_file} usando ogr2ogr")
            
            # Leer el archivo GeoJSON resultante y agregar propiedades
            with open(output_file, 'r') as f:
                geojson = json.load(f)
            
            # Modificar el GeoJSON para agregar propiedades necesarias
            for feature in geojson['features']:
                feature['properties']['id'] = route_id
                feature['properties']['name'] = f"Ruta {route_id}"
                feature['properties']['shortName'] = f"R{route_id}"
                zone = determine_zone(route_id)
                feature['properties']['color'] = zone_colors.get(zone, '#3B82F6')
            
            # Guardar el GeoJSON modificado
            with open(output_file, 'w') as f:
                json.dump(geojson, f)
            
            return output_file
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            # Si ogr2ogr no está disponible o falla, intentar un método alternativo
            print(f"Error al convertir con ogr2ogr: {e}")
            
            # Método alternativo: extraer manualmente las coordenadas y crear GeoJSON
            try:
                # Este es un método muy simplificado y podría no funcionar para todos los shapefiles
                # Para una solución completa, se necesitaría una biblioteca como geopandas
                print(f"No se pudo convertir {shp_file} usando ogr2ogr, se necesita un enfoque alternativo")
                return None
            except Exception as e2:
                print(f"Error en el método alternativo: {e2}")
                return None

# Procesar todos los archivos de ruta
def process_all_routes():
    all_geojson_routes = []
    all_geojson_stops = []
    
    # Encontrar todos los archivos route.zip
    route_zips = []
    for root, dirs, files in os.walk(SHAPEFILES_DIR):
        for file in files:
            if file == 'route.zip':
                route_zips.append(os.path.join(root, file))
    
    print(f"Encontrados {len(route_zips)} archivos de rutas")
    
    # Procesar cada archivo de ruta
    for route_zip in route_zips:
        output_file = process_shapefile_zip(route_zip, OUTPUT_DIR)
        if output_file:
            all_geojson_routes.append(output_file)
    
    print(f"Convertidas {len(all_geojson_routes)} rutas a GeoJSON")
    
    # Combinar todos los GeoJSON en uno solo
    if all_geojson_routes:
        combined_features = []
        for route_file in all_geojson_routes:
            with open(route_file, 'r') as f:
                try:
                    geojson = json.load(f)
                    if 'features' in geojson:
                        combined_features.extend(geojson['features'])
                except json.JSONDecodeError:
                    print(f"Error al decodificar JSON en {route_file}")
        
        combined_geojson = {
            "type": "FeatureCollection",
            "features": combined_features
        }
        
        with open(os.path.join(OUTPUT_DIR, 'all_routes.geojson'), 'w') as f:
            json.dump(combined_geojson, f)
        
        print(f"Creado archivo combinado con {len(combined_features)} rutas")

if __name__ == "__main__":
    process_all_routes()