import { db } from '../server/db';
import { busRoutes } from '../shared/schema';

// Función para verificar el progreso de las rutas ajustadas a las calles
async function checkSnappedRoutes() {
  try {
    // Obtener todas las rutas
    const routes = await db.select().from(busRoutes);
    console.log(`Total de rutas en la base de datos: ${routes.length}`);
    
    // Contadores para análisis
    let snappedCount = 0;
    let notSnappedCount = 0;
    let routesWithMorePoints = 0;
    let routesWithLessPoints = 0;
    let routesWithSamePoints = 0;
    
    // Analizar cada ruta
    for (const route of routes) {
      if (!route.geoJSON) {
        console.warn(`La ruta ${route.id} no tiene datos GeoJSON, omitiendo...`);
        notSnappedCount++;
        continue;
      }
      
      // Convertir de string a objeto si es necesario
      const geoJSON = typeof route.geoJSON === 'string' 
        ? JSON.parse(route.geoJSON) 
        : route.geoJSON;
      
      if (!geoJSON || !geoJSON.geometry || !geoJSON.geometry.coordinates) {
        console.warn(`La ruta ${route.id} tiene formato GeoJSON inválido`);
        notSnappedCount++;
        continue;
      }
      
      const coordinatesCount = geoJSON.geometry.coordinates.length;
      
      // Verificar si la ruta parece haber sido ajustada a calles
      // (Rutas ajustadas típicamente tienen más puntos que las originales)
      const looksSnapped = coordinatesCount >= 40; // Umbral arbitrario basado en observación
      
      if (route.metadata && typeof route.metadata === 'object' && route.metadata !== null) {
        const metadata = route.metadata as any;
        
        if (metadata.originalPointCount) {
          const originalCount = metadata.originalPointCount;
          
          if (coordinatesCount > originalCount) {
            routesWithMorePoints++;
            snappedCount++;
          } else if (coordinatesCount < originalCount) {
            routesWithLessPoints++;
            // Podría ser snapped si tenía muchísimos puntos originales
            if (looksSnapped) snappedCount++;
            else notSnappedCount++;
          } else {
            routesWithSamePoints++;
            notSnappedCount++;
          }
          
          console.log(`Ruta ${route.id}: ${route.name} - Original: ${originalCount} puntos, Actual: ${coordinatesCount} puntos`);
          continue;
        }
      }
      
      // Si no hay metadata para comparar, usar heurística
      if (looksSnapped) {
        snappedCount++;
      } else {
        notSnappedCount++;
      }
      
      console.log(`Ruta ${route.id}: ${route.name} - ${coordinatesCount} puntos (${looksSnapped ? 'parece ajustada' : 'no ajustada'})`);
    }
    
    // Mostrar resultados
    console.log('\n===== RESUMEN =====');
    console.log(`Rutas procesadas: ${routes.length}`);
    console.log(`Rutas que parecen ajustadas a calles: ${snappedCount} (${Math.round(snappedCount/routes.length*100)}%)`);
    console.log(`Rutas que no parecen ajustadas: ${notSnappedCount} (${Math.round(notSnappedCount/routes.length*100)}%)`);
    console.log('\n===== ANÁLISIS DE PUNTOS =====');
    console.log(`Rutas con más puntos después del ajuste: ${routesWithMorePoints}`);
    console.log(`Rutas con menos puntos después del ajuste: ${routesWithLessPoints}`);
    console.log(`Rutas con igual número de puntos: ${routesWithSamePoints}`);
    
  } catch (error) {
    console.error('Error al verificar rutas:', error);
  }
}

// Ejecutar la función principal
async function main() {
  try {
    await checkSnappedRoutes();
    process.exit(0);
  } catch (error) {
    console.error('Error fatal:', error);
    process.exit(1);
  }
}

main();