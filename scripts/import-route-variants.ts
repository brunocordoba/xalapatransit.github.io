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

// Importar variante de una ruta (ida o vuelta)
async function importRouteVariant(baseRouteId: number, variant: 'ida' | 'vuelta') {
  try {
    console.log(`Importando ruta ${baseRouteId} (${variant})...`);
    
    const baseDir = './tmp/corregidos2/Corregidos2';
    const paddedId = baseRouteId.toString().padStart(3, '0');
    
    let uniqueId: number;
    let routeName: string;
    
    if (variant === 'ida') {
      uniqueId = baseRouteId * 1000 + 1;
      routeName = `Ruta ${baseRouteId} (Ida)`;
    } else {
      uniqueId = baseRouteId * 1000 + 2;
      routeName = `Ruta ${baseRouteId} (Vuelta)`;
    }
    
    // Buscar archivos (varios formatos posibles)
    let routeFilePath = path.join(baseDir, `${paddedId}_${variant}_route.geojson`);
    let stopsFilePath = path.join(baseDir, `${paddedId}_${variant}_stops.geojson`);
    
    // Probar formato alternativo route_ida/vuelta
    if (!fs.existsSync(routeFilePath)) {
      const altRoutePath = path.join(baseDir, `${paddedId}_route_${variant}.geojson`);
      if (fs.existsSync(altRoutePath)) {
        routeFilePath = altRoutePath;
      }
    }
    
    // Probar varias opciones para archivos de paradas
    if (!fs.existsSync(stopsFilePath)) {
      // Opción 1: archivo _stop singular
      const stopPath = path.join(baseDir, `${paddedId}_${variant}_stop.geojson`);
      if (fs.existsSync(stopPath)) {
        stopsFilePath = stopPath;
      } else {
        // Opción 2: formato stops_ida/vuelta
        const altStopsPath = path.join(baseDir, `${paddedId}_stops_${variant}.geojson`);
        if (fs.existsSync(altStopsPath)) {
          stopsFilePath = altStopsPath;
        }
      }
    }
    
    if (!fs.existsSync(routeFilePath)) {
      console.log(`No se encontró archivo de ruta: ${routeFilePath}`);
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
      shortName: `R${baseRouteId}${variant === 'ida' ? 'I' : 'V'}`,
      color: getRouteColor(baseRouteId),
      frequency: "10-15 min",
      scheduleStart: '05:00',
      scheduleEnd: '23:00',
      stopsCount: 0, // Se actualizará después
      approximateTime: "30 min",
      zone: baseRouteId <= 20 ? 'Norte' : (baseRouteId <= 50 ? 'Sur' : (baseRouteId <= 80 ? 'Este' : 'Oeste')),
      popular: baseRouteId <= 10, // Las primeras 10 rutas son populares
      geoJSON: routeData
    });
    
    console.log(`Ruta ${uniqueId} (${routeName}) importada`);
    
    // Importar paradas si existen
    let stopsCount = 0;
    if (fs.existsSync(stopsFilePath)) {
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
    } else {
      console.log(`No se encontró archivo de paradas para la ruta ${uniqueId}`);
    }
    
    console.log(`Ruta ${uniqueId} (${routeName}) importada con ${stopsCount} paradas`);
    
  } catch (error) {
    console.error(`Error importando ruta:`, error);
  }
}

// Función principal
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Uso: npx tsx scripts/import-route-variants.ts [ID_RUTA] [ida|vuelta|both]');
    console.log('Ejemplo: npx tsx scripts/import-route-variants.ts 3 ida');
    process.exit(1);
  }
  
  const routeId = parseInt(args[0], 10);
  const variant = args[1].toLowerCase();
  
  if (isNaN(routeId)) {
    console.error('El ID de la ruta debe ser un número');
    process.exit(1);
  }
  
  if (variant === 'ida') {
    await importRouteVariant(routeId, 'ida');
  } else if (variant === 'vuelta') {
    await importRouteVariant(routeId, 'vuelta');
  } else if (variant === 'both' || variant === 'ambas') {
    await importRouteVariant(routeId, 'ida');
    await importRouteVariant(routeId, 'vuelta');
  } else {
    console.error('La variante debe ser "ida", "vuelta" o "both"');
    process.exit(1);
  }
  
  console.log('Importación completada');
}

main().catch(err => {
  console.error('Error durante la importación:', err);
  process.exit(1);
});