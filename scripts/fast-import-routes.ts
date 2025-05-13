import fs from 'fs';
import path from 'path';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Colores para rutas
function getRouteColor(routeId: number): string {
  // Colores específicos para cada zona
  const colors = [
    '#f44336', // Rojo - Norte
    '#2196f3', // Azul - Sur
    '#4caf50', // Verde - Este
    '#9c27b0', // Púrpura - Oeste
    '#ff9800'  // Naranja - Centro
  ];
  
  // Distribuir colores uniformemente entre rutas
  return colors[routeId % colors.length];
}

// Importar una ruta rápidamente
async function fastImportRoute(routeId: number) {
  try {
    console.log(`Importando ruta ${routeId}...`);
    
    const baseDir = './tmp/corregidos2/Corregidos2';
    
    // Buscar archivo de ruta
    let routeFilePath = '';
    let stopsFilePath = '';
    let routeType = 'direct';
    let uniqueId = routeId;
    let routeName = `Ruta ${routeId}`;
    
    // Verificar si existe la versión directa
    if (fs.existsSync(path.join(baseDir, `${routeId.toString().padStart(3, '0')}_route.geojson`))) {
      routeFilePath = path.join(baseDir, `${routeId.toString().padStart(3, '0')}_route.geojson`);
      
      // Buscar archivo de paradas correspondiente
      if (fs.existsSync(path.join(baseDir, `${routeId.toString().padStart(3, '0')}_stops.geojson`))) {
        stopsFilePath = path.join(baseDir, `${routeId.toString().padStart(3, '0')}_stops.geojson`);
      } else if (fs.existsSync(path.join(baseDir, `${routeId.toString().padStart(3, '0')}_stop.geojson`))) {
        stopsFilePath = path.join(baseDir, `${routeId.toString().padStart(3, '0')}_stop.geojson`);
      }
    } 
    // Si no existe la versión directa, verificar si existe la versión ida
    else if (fs.existsSync(path.join(baseDir, `${routeId.toString().padStart(3, '0')}_ida_route.geojson`))) {
      routeFilePath = path.join(baseDir, `${routeId.toString().padStart(3, '0')}_ida_route.geojson`);
      routeType = 'ida';
      uniqueId = routeId * 1000 + 1;
      routeName = `Ruta ${routeId} (Ida)`;
      
      // Buscar archivo de paradas
      if (fs.existsSync(path.join(baseDir, `${routeId.toString().padStart(3, '0')}_ida_stops.geojson`))) {
        stopsFilePath = path.join(baseDir, `${routeId.toString().padStart(3, '0')}_ida_stops.geojson`);
      } else if (fs.existsSync(path.join(baseDir, `${routeId.toString().padStart(3, '0')}_ida_stop.geojson`))) {
        stopsFilePath = path.join(baseDir, `${routeId.toString().padStart(3, '0')}_ida_stop.geojson`);
      }
    }
    // Verificar si existe la versión vuelta
    else if (fs.existsSync(path.join(baseDir, `${routeId.toString().padStart(3, '0')}_vuelta_route.geojson`))) {
      routeFilePath = path.join(baseDir, `${routeId.toString().padStart(3, '0')}_vuelta_route.geojson`);
      routeType = 'vuelta';
      uniqueId = routeId * 1000 + 2;
      routeName = `Ruta ${routeId} (Vuelta)`;
      
      // Buscar archivo de paradas
      if (fs.existsSync(path.join(baseDir, `${routeId.toString().padStart(3, '0')}_vuelta_stops.geojson`))) {
        stopsFilePath = path.join(baseDir, `${routeId.toString().padStart(3, '0')}_vuelta_stops.geojson`);
      } else if (fs.existsSync(path.join(baseDir, `${routeId.toString().padStart(3, '0')}_vuelta_stop.geojson`))) {
        stopsFilePath = path.join(baseDir, `${routeId.toString().padStart(3, '0')}_vuelta_stop.geojson`);
      }
    }
    
    if (!routeFilePath) {
      console.log(`No se encontró archivo de ruta para la ruta ${routeId}`);
      return;
    }
    
    // Eliminar ruta si ya existe
    await db.delete(busStops).where(eq(busStops.routeId, uniqueId));
    await db.delete(busRoutes).where(eq(busRoutes.id, uniqueId));
    
    // Leer archivo de ruta
    const routeData = JSON.parse(fs.readFileSync(routeFilePath, 'utf8'));
    
    // Extraer datos GeoJSON
    const feature = routeData.features[0];
    if (!feature || !feature.geometry) {
      console.error(`Geometría no encontrada en la ruta: ${routeFilePath}`);
      return;
    }
    
    // Insertar ruta
    await db.insert(busRoutes).values({
      id: uniqueId,
      name: routeName,
      shortName: `R${routeId}`,
      color: getRouteColor(routeId),
      frequency: "10-15 min",
      scheduleStart: '05:00',
      scheduleEnd: '23:00',
      stopsCount: 0, // Se actualizará después
      approximateTime: "30 min",
      zone: routeId <= 20 ? 'Norte' : (routeId <= 50 ? 'Sur' : (routeId <= 80 ? 'Este' : 'Oeste')),
      popular: routeId <= 10, // Las primeras 10 rutas son populares
      geoJSON: routeData
    });
    
    console.log(`Ruta ${uniqueId} (${routeName}) importada`);
    
    // Importar paradas si existen
    let stopsCount = 0;
    if (stopsFilePath && fs.existsSync(stopsFilePath)) {
      const stopsData = JSON.parse(fs.readFileSync(stopsFilePath, 'utf8'));
      
      if (stopsData.features && stopsData.features.length > 0) {
        console.log(`Importando ${stopsData.features.length} paradas para ruta ${uniqueId}`);
        
        for (let i = 0; i < stopsData.features.length; i++) {
          const stopFeature = stopsData.features[i];
          const stopGeometry = stopFeature.geometry;
          
          if (stopGeometry.type !== 'Point') continue;
          
          const position = stopGeometry.coordinates;
          
          // Verificar que las coordenadas sean válidas
          if (!Array.isArray(position) || position.length !== 2) continue;
          
          // Determinar si es terminal
          const isTerminal = i === 0 || i === stopsData.features.length - 1;
          const terminalType = i === 0 ? 'origin' : (i === stopsData.features.length - 1 ? 'destination' : '');
          
          // Crear parada
          await db.insert(busStops).values({
            routeId: uniqueId,
            name: `Parada ${i + 1}`,
            latitude: position[1].toString(),
            longitude: position[0].toString(),
            order: i,
            isTerminal: isTerminal,
            terminalType: terminalType
          });
          
          stopsCount++;
        }
        
        // Actualizar contador de paradas
        if (stopsCount > 0) {
          await db.execute(`UPDATE bus_routes SET stops_count = ${stopsCount} WHERE id = ${uniqueId}`);
          console.log(`Actualizado contador de paradas para ruta ${uniqueId}: ${stopsCount} paradas`);
        }
      }
    }
    
    console.log(`Ruta ${uniqueId} (${routeName}) importada con ${stopsCount} paradas`);
    
  } catch (error) {
    console.error(`Error importando ruta ${routeId}:`, error);
  }
}

// Función principal
async function main() {
  // IDs de las rutas importantes a importar
  const routeIds = [1, 2, 3, 4, 5];
  
  if (process.argv.length > 2) {
    // Si se proporcionaron IDs de ruta específicos, usar esos
    const requestedIds = process.argv.slice(2).map(id => parseInt(id, 10));
    for (const id of requestedIds) {
      if (!isNaN(id)) {
        await fastImportRoute(id);
      }
    }
  } else {
    // Importar rutas importantes por defecto
    for (const id of routeIds) {
      await fastImportRoute(id);
    }
  }
  
  console.log('Importación completada');
}

main().catch(err => {
  console.error('Error durante la importación:', err);
  process.exit(1);
});