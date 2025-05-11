# Guía para importar datos de Mapaton.org

Este documento explica cómo importar los datos de rutas de autobús de Mapaton.org a la aplicación.

## Pasos para la importación

### 1. Descarga los datos

1. Visita [https://mapaton.org/rutas/](https://mapaton.org/rutas/)
2. Descarga los shapefiles (archivos con extensiones .shp, .dbf, .prj, .shx)

### 2. Prepara los archivos

1. Crea la carpeta para los shapefiles si no existe:
   ```bash
   mkdir -p data/shapefiles
   ```

2. Descomprime los archivos descargados:
   ```bash
   unzip shapefiles-mapaton-ciudadano.zip -d data/tmp
   ```

3. Mueve los archivos necesarios:
   ```bash
   # Para las rutas
   cp data/tmp/*rutas*.shp data/shapefiles/rutas.shp
   cp data/tmp/*rutas*.dbf data/shapefiles/rutas.dbf
   cp data/tmp/*rutas*.shx data/shapefiles/rutas.shx
   cp data/tmp/*rutas*.prj data/shapefiles/rutas.prj
   
   # Para las paradas
   cp data/tmp/*paradas*.shp data/shapefiles/paradas.shp
   cp data/tmp/*paradas*.dbf data/shapefiles/paradas.dbf
   cp data/tmp/*paradas*.shx data/shapefiles/paradas.shx
   cp data/tmp/*paradas*.prj data/shapefiles/paradas.prj
   ```

   > Nota: Si los archivos tienen nombres diferentes, ajusta los comandos según corresponda.

### 3. Importa los datos

1. Ejecuta el script de importación:
   ```bash
   ./import-data.sh
   ```

2. Espera a que termine el proceso. Verás mensajes de progreso en la consola.

3. Reinicia la aplicación para ver los cambios:
   ```bash
   npm run dev
   ```

## Notas importantes

- **Respaldo**: Antes de importar, el script limpia la base de datos. Si ya tenías datos que quieres conservar, haz un respaldo primero.
- **Personalización**: Si necesitas ajustar cómo se interpretan los datos, edita el archivo `scripts/import-shapefiles.ts`.
- **Estructura de datos**: El script está diseñado para trabajar con la estructura de datos de Mapaton.org, pero podría necesitar ajustes si la estructura cambió.

## Estructura de campos esperada

El script busca estos campos en los shapefiles:

### Para rutas:
- `nombre`, `route_name` o `linea` - Nombre de la ruta
- `origen` y `destino` - Punto de origen y destino
- `region`, `area` o `zona` - Zona geográfica
- `id` o `route_id` - Identificador único

### Para paradas:
- `nombre` o `name` - Nombre de la parada
- `route_id`, `ruta_id` o `routeId` - ID de la ruta a la que pertenece
- `isTerminal` - Indica si es una terminal (true/false)
- Coordenadas geográficas (incluidas en el shapefile)

Si tus datos usan nombres de campo diferentes, puedes ajustar el script según sea necesario.