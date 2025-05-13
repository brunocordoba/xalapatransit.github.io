import * as fs from 'fs';
import * as path from 'path';

// Ruta a la carpeta que contiene los shapefiles
const SHAPEFILES_DIR = './tmp/extracted/shapefiles-mapton-ciudadano';

// Función para extraer los IDs de las rutas disponibles
function extractRouteIds() {
  console.log('Extrayendo IDs de rutas disponibles...');
  
  try {
    // Leer todas las carpetas de rutas
    const routeDirs = fs.readdirSync(SHAPEFILES_DIR)
      .filter(dir => dir.includes('_circuito') && !dir.startsWith('.'))
      .filter(dir => !fs.lstatSync(path.join(SHAPEFILES_DIR, dir)).isFile());
    
    console.log(`Encontradas ${routeDirs.length} carpetas de rutas`);
    
    // Extraer IDs de las carpetas
    const routeIds = routeDirs.map(dir => {
      const routeNumber = dir.split('_')[0];
      return {
        id: parseInt(routeNumber),
        dir: dir,
        hasIda: fs.existsSync(path.join(SHAPEFILES_DIR, dir, 'ida')),
        hasVuelta: fs.existsSync(path.join(SHAPEFILES_DIR, dir, 'vuelta')),
        hasDirect: fs.existsSync(path.join(SHAPEFILES_DIR, dir, 'route.zip'))
      };
    }).filter(route => !isNaN(route.id));
    
    // Ordenar por ID
    routeIds.sort((a, b) => a.id - b.id);
    
    // Imprimir información sobre las rutas
    console.log('IDs de rutas disponibles:');
    routeIds.forEach(route => {
      const directions = [];
      if (route.hasIda) directions.push('ida');
      if (route.hasVuelta) directions.push('vuelta');
      if (route.hasDirect) directions.push('directa');
      
      console.log(`  Ruta ${route.id} (${route.dir}): Direcciones: ${directions.join(', ')}`);
    });
    
    // Generar código para usarlo en otro script
    console.log('\nARRAY PARA UTILIZAR EN SCRIPTS:');
    console.log('const ROUTE_IDS = [');
    routeIds.slice(0, 10).forEach(route => {
      console.log(`  { id: ${route.id}, dir: "${route.dir}" },`);
    });
    console.log('];');
    
    return routeIds;
  } catch (error) {
    console.error('Error extrayendo IDs de rutas:', error);
    throw error;
  }
}

// Ejecutar la extracción
function main() {
  try {
    extractRouteIds();
    console.log('Proceso completado con éxito');
  } catch (error) {
    console.error('Error fatal:', error);
    process.exit(1);
  }
}

main();