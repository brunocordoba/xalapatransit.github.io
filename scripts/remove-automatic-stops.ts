import { db } from '../server/db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { busRoutes as routes, busStops as stops } from '../shared/schema';

// Función para eliminar paradas automáticas
async function removeAutomaticStops() {
  try {
    console.log('Iniciando eliminación de paradas generadas automáticamente...');
    
    // Identificar las rutas que acabamos de importar (las que nos pidieron: 76, 78, 81)
    // 694 = Ruta 76, 695 = Ruta 78, 696 = Ruta 81, 697 = Ruta 68
    // Vamos a eliminar las paradas generadas automáticamente
    const routesToClean = [694, 695, 696];
    
    // Eliminar las paradas de las rutas que queremos limpiar
    const result = await db.delete(stops)
      .where(
        inArray(stops.routeId, routesToClean)
      )
      .returning();
    
    console.log(`Se eliminaron ${result.length} paradas generadas automáticamente.`);
    
    // Actualizar el contador de paradas en cada ruta
    const routesList = await db.select().from(routes);
    let totalUpdated = 0;
    
    for (const route of routesList) {
      // Contar paradas reales de esta ruta
      const [{ count }] = await db
        .select({ count: sql`count(*)` })
        .from(stops)
        .where(eq(stops.routeId, route.id));
      
      // Actualizar el contador en la ruta
      await db.update(routes)
        .set({ stopsCount: Number(count) })
        .where(eq(routes.id, route.id));
      
      console.log(`Ruta ${route.id} actualizada: ${count} paradas.`);
      totalUpdated++;
    }
    
    console.log(`Se actualizaron los contadores de paradas en ${totalUpdated} rutas.`);
    
  } catch (error) {
    console.error('Error eliminando paradas automáticas:', error);
  }
}

// Función principal
async function main() {
  await removeAutomaticStops();
  console.log('Proceso de limpieza completado.');
}

main().catch(console.error);