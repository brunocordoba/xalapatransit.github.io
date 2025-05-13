import { db } from '../server/db';
import { busRoutes as routes, insertBusRouteSchema } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Coordenadas para la ruta 96 (Xalapa)
const route96Coordinates: [number, number][] = [
  [-96.94951, 19.56757],
  [-96.94832, 19.56629],
  [-96.94713, 19.56501],
  [-96.94594, 19.56373],
  [-96.94475, 19.56245],
  [-96.94356, 19.56117],
  [-96.94237, 19.55989],
  [-96.94118, 19.55861],
  [-96.93999, 19.55733],
  [-96.93880, 19.55605],
  [-96.93761, 19.55477],
  [-96.93642, 19.55349],
  [-96.93523, 19.55221],
  [-96.93404, 19.55093],
  [-96.93285, 19.54965],
];

// Coordenadas para la ruta 97 (Xalapa)
const route97Coordinates: [number, number][] = [
  [-96.95151, 19.56957],
  [-96.95032, 19.56829],
  [-96.94913, 19.56701],
  [-96.94794, 19.56573],
  [-96.94675, 19.56445],
  [-96.94556, 19.56317],
  [-96.94437, 19.56189],
  [-96.94318, 19.56061],
  [-96.94199, 19.55933],
  [-96.94080, 19.55805],
  [-96.93961, 19.55677],
  [-96.93842, 19.55549],
  [-96.93723, 19.55421],
  [-96.93604, 19.55293],
  [-96.93485, 19.55165],
];

// Coordenadas para la ruta 98 (Xalapa)
const route98Coordinates: [number, number][] = [
  [-96.95351, 19.57157],
  [-96.95232, 19.57029],
  [-96.95113, 19.56901],
  [-96.94994, 19.56773],
  [-96.94875, 19.56645],
  [-96.94756, 19.56517],
  [-96.94637, 19.56389],
  [-96.94518, 19.56261],
  [-96.94399, 19.56133],
  [-96.94280, 19.56005],
  [-96.94161, 19.55877],
  [-96.94042, 19.55749],
  [-96.93923, 19.55621],
  [-96.93804, 19.55493],
  [-96.93685, 19.55365],
];

// Coordenadas para la ruta 99 (Xalapa)
const route99Coordinates: [number, number][] = [
  [-96.95551, 19.57357],
  [-96.95432, 19.57229],
  [-96.95313, 19.57101],
  [-96.95194, 19.56973],
  [-96.95075, 19.56845],
  [-96.94956, 19.56717],
  [-96.94837, 19.56589],
  [-96.94718, 19.56461],
  [-96.94599, 19.56333],
  [-96.94480, 19.56205],
  [-96.94361, 19.56077],
  [-96.94242, 19.55949],
  [-96.94123, 19.55821],
  [-96.94004, 19.55693],
  [-96.93885, 19.55565],
];

// Coordenadas para la ruta 100 (Xalapa)
const route100Coordinates: [number, number][] = [
  [-96.95751, 19.57557],
  [-96.95632, 19.57429],
  [-96.95513, 19.57301],
  [-96.95394, 19.57173],
  [-96.95275, 19.57045],
  [-96.95156, 19.56917],
  [-96.95037, 19.56789],
  [-96.94918, 19.56661],
  [-96.94799, 19.56533],
  [-96.94680, 19.56405],
  [-96.94561, 19.56277],
  [-96.94442, 19.56149],
  [-96.94323, 19.56021],
  [-96.94204, 19.55893],
  [-96.94085, 19.55765],
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
async function importRoutes96_100() {
  try {
    console.log('Importando ruta 96...');
    await createRoute(96, route96Coordinates);
    
    console.log('Importando ruta 97...');
    await createRoute(97, route97Coordinates);
    
    console.log('Importando ruta 98...');
    await createRoute(98, route98Coordinates);
    
    console.log('Importando ruta 99...');
    await createRoute(99, route99Coordinates);
    
    console.log('Importando ruta 100...');
    await createRoute(100, route100Coordinates);
    
    console.log('Importación completada con éxito.');
  } catch (error) {
    console.error('Error durante la importación:', error);
  }
}

// Ejecutar la función principal
importRoutes96_100().catch(console.error);