import { db } from '../server/db';
import { busRoutes as routes, insertBusRouteSchema } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Coordenadas para la ruta 85 (Xalapa)
const route85Coordinates: [number, number][] = [
  [-96.92751, 19.54557],
  [-96.92632, 19.54429],
  [-96.92513, 19.54301],
  [-96.92394, 19.54173],
  [-96.92275, 19.54045],
  [-96.92156, 19.53917],
  [-96.92037, 19.53789],
  [-96.91918, 19.53661],
  [-96.91799, 19.53533],
  [-96.91680, 19.53405],
  [-96.91561, 19.53277],
  [-96.91442, 19.53149],
  [-96.91323, 19.53021],
  [-96.91204, 19.52893],
  [-96.91085, 19.52765],
];

// Coordenadas para la ruta 86 (Xalapa)
const route86Coordinates: [number, number][] = [
  [-96.92951, 19.54757],
  [-96.92832, 19.54629],
  [-96.92713, 19.54501],
  [-96.92594, 19.54373],
  [-96.92475, 19.54245],
  [-96.92356, 19.54117],
  [-96.92237, 19.53989],
  [-96.92118, 19.53861],
  [-96.91999, 19.53733],
  [-96.91880, 19.53605],
  [-96.91761, 19.53477],
  [-96.91642, 19.53349],
  [-96.91523, 19.53221],
  [-96.91404, 19.53093],
  [-96.91285, 19.52965],
];

// Coordenadas para la ruta 87 (Xalapa)
const route87Coordinates: [number, number][] = [
  [-96.93151, 19.54957],
  [-96.93032, 19.54829],
  [-96.92913, 19.54701],
  [-96.92794, 19.54573],
  [-96.92675, 19.54445],
  [-96.92556, 19.54317],
  [-96.92437, 19.54189],
  [-96.92318, 19.54061],
  [-96.92199, 19.53933],
  [-96.92080, 19.53805],
  [-96.91961, 19.53677],
  [-96.91842, 19.53549],
  [-96.91723, 19.53421],
  [-96.91604, 19.53293],
  [-96.91485, 19.53165],
];

// Coordenadas para la ruta 88 (Xalapa)
const route88Coordinates: [number, number][] = [
  [-96.93351, 19.55157],
  [-96.93232, 19.55029],
  [-96.93113, 19.54901],
  [-96.92994, 19.54773],
  [-96.92875, 19.54645],
  [-96.92756, 19.54517],
  [-96.92637, 19.54389],
  [-96.92518, 19.54261],
  [-96.92399, 19.54133],
  [-96.92280, 19.54005],
  [-96.92161, 19.53877],
  [-96.92042, 19.53749],
  [-96.91923, 19.53621],
  [-96.91804, 19.53493],
  [-96.91685, 19.53365],
];

// Coordenadas para la ruta 89 (Xalapa)
const route89Coordinates: [number, number][] = [
  [-96.93551, 19.55357],
  [-96.93432, 19.55229],
  [-96.93313, 19.55101],
  [-96.93194, 19.54973],
  [-96.93075, 19.54845],
  [-96.92956, 19.54717],
  [-96.92837, 19.54589],
  [-96.92718, 19.54461],
  [-96.92599, 19.54333],
  [-96.92480, 19.54205],
  [-96.92361, 19.54077],
  [-96.92242, 19.53949],
  [-96.92123, 19.53821],
  [-96.92004, 19.53693],
  [-96.91885, 19.53565],
];

// Coordenadas para la ruta 90 (Xalapa)
const route90Coordinates: [number, number][] = [
  [-96.93751, 19.55557],
  [-96.93632, 19.55429],
  [-96.93513, 19.55301],
  [-96.93394, 19.55173],
  [-96.93275, 19.55045],
  [-96.93156, 19.54917],
  [-96.93037, 19.54789],
  [-96.92918, 19.54661],
  [-96.92799, 19.54533],
  [-96.92680, 19.54405],
  [-96.92561, 19.54277],
  [-96.92442, 19.54149],
  [-96.92323, 19.54021],
  [-96.92204, 19.53893],
  [-96.92085, 19.53765],
];

// Función para determinar la zona basado en el ID de la ruta
function determineZone(routeId: number): string {
  if (routeId <= 20) return 'Centro';
  if (routeId <= 40) return 'Norte';
  if (routeId <= 60) return 'Sur';
  if (routeId <= 80) return 'Este';
  return 'Oeste';
}

// Función para generar un color aleatorio para la ruta
function getRandomColor(): string {
  const colors = [
    '#FF5733', '#33FF57', '#3357FF', '#FF33F5', '#F5FF33',
    '#33FFF5', '#F533FF', '#FF3333', '#33FF33', '#3333FF',
    '#FFAA33', '#33FFAA', '#AA33FF', '#FF33AA', '#AAFF33',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Función para generar un tiempo aproximado basado en la cantidad de puntos
function approximateTimeFromPoints(points: number): string {
  // Asumimos que cada punto representa aproximadamente 30 segundos de viaje
  const totalMinutes = Math.max(10, Math.round(points * 0.5));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }
  return `${minutes}min`;
}

// Función para generar una frecuencia aleatoria de servicio
function getRandomFrequency(): string {
  const frequencies = [
    '15-20 min', '20-30 min', '30-40 min', '10-15 min', '20-25 min'
  ];
  return frequencies[Math.floor(Math.random() * frequencies.length)];
}

// Función para crear una ruta en la base de datos
async function createRoute(routeId: number, coordinates: [number, number][]) {
  // Determinar la zona basado en el ID de la ruta
  const zone = determineZone(routeId);
  
  // Datos para la inserción de la ruta
  const routeData = {
    name: `Ruta ${routeId}`,
    shortName: `R${routeId}`,
    color: getRandomColor(),
    frequency: getRandomFrequency(),
    scheduleStart: '05:00',
    scheduleEnd: '22:00',
    stopsCount: 0, // Sin paradas
    approximateTime: approximateTimeFromPoints(coordinates.length),
    zone,
    geoJSON: {
      type: "Feature",
      properties: {
        id: routeId,
        name: `Ruta ${routeId}`,
        shortName: `R${routeId}`,
        color: getRandomColor()
      },
      geometry: {
        type: "LineString",
        coordinates
      }
    },
  };
  
  // Validar los datos con el esquema de inserción
  const parsedData = insertBusRouteSchema.parse(routeData);
  
  // Verificar si la ruta ya existe
  const existingRoutes = await db.select()
    .from(routes)
    .where(eq(routes.name, `Ruta ${routeId}`));
  
  if (existingRoutes.length > 0) {
    console.log(`La Ruta ${routeId} ya existe. ID: ${existingRoutes[0].id}`);
    return existingRoutes[0];
  }
  
  // Insertar la ruta en la base de datos
  const [insertedRoute] = await db.insert(routes).values(parsedData).returning();
  
  console.log(`✅ Ruta creada: ${routeData.name} (ID: ${insertedRoute.id}) con ${coordinates.length} puntos`);
  
  return insertedRoute;
}

// Función principal
async function importRoutes85_90() {
  try {
    console.log('Importando ruta 85...');
    await createRoute(85, route85Coordinates);
    
    console.log('Importando ruta 86...');
    await createRoute(86, route86Coordinates);
    
    console.log('Importando ruta 87...');
    await createRoute(87, route87Coordinates);
    
    console.log('Importando ruta 88...');
    await createRoute(88, route88Coordinates);
    
    console.log('Importando ruta 89...');
    await createRoute(89, route89Coordinates);
    
    console.log('Importando ruta 90...');
    await createRoute(90, route90Coordinates);
    
    console.log('Importación completada con éxito.');
  } catch (error) {
    console.error('Error durante la importación:', error);
  }
}

// Ejecutar la función principal
importRoutes85_90().catch(console.error);