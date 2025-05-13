import { db } from '../server/db';
import { busRoutes as routes, busStops as stops, insertBusStopSchema } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Función para añadir paradas manualmente a una ruta
async function addStopsManually(routeId: number) {
  console.log(`Añadiendo paradas manualmente para la ruta ${routeId}`);
  
  try {
    // Coordenadas de paradas basadas en el ID de la ruta
    let stopCoordinates: [number, number][] = [];
    let routeName = '';
    
    // Ruta 78 (ID 695)
    if (routeId === 695) {
      routeName = 'Ruta 78';
      stopCoordinates = [
        [-96.92155, 19.54023], // Terminal
        [-96.92035, 19.53784],
        [-96.91904, 19.53556],
        [-96.91712, 19.53294],
        [-96.91532, 19.53056],
        [-96.91349, 19.52811],
        [-96.91125, 19.52578],
        [-96.90895, 19.52342],
        [-96.90694, 19.52118],
        [-96.90485, 19.51883],
        [-96.90267, 19.51651],
        [-96.90051, 19.51418],
        [-96.89834, 19.51185],
        [-96.89645, 19.50962],
        [-96.89452, 19.50742],
        [-96.89264, 19.50523],
        [-96.89072, 19.50302],
        [-96.88879, 19.50084],
        [-96.88698, 19.49874],
        [-96.88517, 19.49664],
        [-96.88336, 19.49453],
        [-96.88147, 19.49238],
        [-96.87953, 19.49043], // Terminal
      ];
    } 
    // Ruta 81 (ID 696)
    else if (routeId === 696) {
      routeName = 'Ruta 81';
      stopCoordinates = [
        [-96.89856, 19.53928], // Terminal
        [-96.89634, 19.53742],
        [-96.89425, 19.53589],
        [-96.89238, 19.53427],
        [-96.89052, 19.53265],
        [-96.88874, 19.53094],
        [-96.88689, 19.52894],
        [-96.88503, 19.52694],
        [-96.88334, 19.52509],
        [-96.88165, 19.52324],
        [-96.87996, 19.52139],
        [-96.87781, 19.51954],
        [-96.87593, 19.51778],
        [-96.87385, 19.51602],
        [-96.87196, 19.51436],
        [-96.87008, 19.51269],
        [-96.86829, 19.51075], // Terminal
      ];
    } else {
      console.error(`No hay coordenadas definidas para la ruta ${routeId}`);
      return 0;
    }
    
    console.log(`Agregando ${stopCoordinates.length} paradas para ${routeName} (ID: ${routeId})`);
    
    // Generar las paradas
    let stopsCreated = 0;
    for (let i = 0; i < stopCoordinates.length; i++) {
      const isTerminal = i === 0 || i === stopCoordinates.length - 1;
      const terminalType = i === 0 ? 'origen' : (i === stopCoordinates.length - 1 ? 'destino' : '');
      
      // Crear la parada
      const stopData = {
        routeId,
        name: isTerminal ? 'Terminal' : `Parada ${i + 1}`,
        latitude: stopCoordinates[i][1].toString(),
        longitude: stopCoordinates[i][0].toString(),
        isTerminal,
        terminalType
      };
      
      // Validar e insertar en la base de datos
      const parsedData = insertBusStopSchema.parse(stopData);
      const [insertedStop] = await db.insert(stops).values(parsedData).returning();
      
      console.log(`Parada creada: ${stopData.name} (ID: ${insertedStop.id})`);
      stopsCreated++;
    }
    
    // Actualizar el contador de paradas en la ruta
    await db.update(routes)
      .set({ stopsCount: stopsCreated })
      .where(eq(routes.id, routeId));
    
    console.log(`Se crearon ${stopsCreated} paradas para la ruta ${routeId}`);
    return stopsCreated;
    
  } catch (error) {
    console.error(`Error agregando paradas manualmente para ruta ${routeId}:`, error);
    return 0;
  }
}

// Función principal
async function main() {
  if (process.argv.length < 3) {
    console.error('Uso: npx tsx scripts/manually-add-stops.ts <id_ruta>');
    process.exit(1);
  }
  
  const routeId = parseInt(process.argv[2], 10);
  
  if (isNaN(routeId)) {
    console.error('El ID de ruta debe ser un número válido');
    process.exit(1);
  }
  
  const stopsCreated = await addStopsManually(routeId);
  console.log(`Proceso completado. Se crearon ${stopsCreated} paradas.`);
}

main().catch(console.error);