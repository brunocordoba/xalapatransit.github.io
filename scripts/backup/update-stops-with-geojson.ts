import { db } from "../server/db";
import { busStops } from "../shared/schema";
import { eq } from "drizzle-orm";

/**
 * Este script actualiza todas las paradas en la base de datos
 * para agregar campos de ubicación en formato GeoJSON
 */
async function updateStopsWithGeoJSON() {
  try {
    console.log("Obteniendo todas las paradas de la base de datos...");
    const stops = await db.select().from(busStops);
    console.log(`Se encontraron ${stops.length} paradas para actualizar`);

    let updatedCount = 0;
    let errorCount = 0;

    for (const stop of stops) {
      try {
        // Crear el objeto de ubicación en formato GeoJSON
        const location = {
          type: "Point",
          coordinates: [parseFloat(stop.longitude), parseFloat(stop.latitude)]
        };

        // Actualizar la parada en la base de datos
        await db.update(busStops)
          .set({ location })
          .where(eq(busStops.id, stop.id));
        
        updatedCount++;
        
        // Mostrar progreso cada 100 paradas
        if (updatedCount % 100 === 0) {
          console.log(`Actualizadas ${updatedCount} paradas de ${stops.length}`);
        }
      } catch (err) {
        console.error(`Error al actualizar la parada ${stop.id}:`, err);
        errorCount++;
      }
    }

    console.log(`\nActualización completada:`);
    console.log(`- Total de paradas: ${stops.length}`);
    console.log(`- Paradas actualizadas: ${updatedCount}`);
    console.log(`- Errores: ${errorCount}`);

  } catch (error) {
    console.error("Error al actualizar las paradas:", error);
  } finally {
    // En Neondatabase con Drizzle no necesitamos cerrar manualmente la conexión
    // La conexión se cierra automáticamente cuando termina el proceso
  }
}

// Ejecutar la función principal
updateStopsWithGeoJSON()
  .then(() => {
    console.log("Script finalizado");
    process.exit(0);
  })
  .catch(err => {
    console.error("Error fatal:", err);
    process.exit(1);
  });