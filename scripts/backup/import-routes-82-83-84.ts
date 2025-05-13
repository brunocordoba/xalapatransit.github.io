import { db } from '../server/db';
import { busRoutes as routes, insertBusRouteSchema } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Coordenadas para la ruta 82 (Xalapa)
const route82Coordinates: [number, number][] = [
  [-96.91851, 19.53457],
  [-96.91732, 19.53329],
  [-96.91613, 19.53201],
  [-96.91494, 19.53073],
  [-96.91375, 19.52945],
  [-96.91256, 19.52817],
  [-96.91137, 19.52689],
  [-96.91018, 19.52561],
  [-96.90899, 19.52433],
  [-96.90780, 19.52305],
  [-96.90661, 19.52177],
  [-96.90542, 19.52049],
  [-96.90423, 19.51921],
  [-96.90304, 19.51793],
  [-96.90185, 19.51665],
  [-96.90066, 19.51537],
];

// Coordenadas para la ruta 83 (Xalapa)
const route83Coordinates: [number, number][] = [
  [-96.92351, 19.54157],
  [-96.92232, 19.54029],
  [-96.92113, 19.53901],
  [-96.91994, 19.53773],
  [-96.91875, 19.53645],
  [-96.91756, 19.53517],
  [-96.91637, 19.53389],
  [-96.91518, 19.53261],
  [-96.91399, 19.53133],
  [-96.91280, 19.53005],
  [-96.91161, 19.52877],
  [-96.91042, 19.52749],
  [-96.90923, 19.52621],
  [-96.90804, 19.52493],
  [-96.90685, 19.52365],
];

// Coordenadas para la ruta 84 (Xalapa)
const route84Coordinates: [number, number][] = [
  [-96.92551, 19.54357],
  [-96.92432, 19.54229],
  [-96.92313, 19.54101],
  [-96.92194, 19.53973],
  [-96.92075, 19.53845],
  [-96.91956, 19.53717],
  [-96.91837, 19.53589],
  [-96.91718, 19.53461],
  [-96.91599, 19.53333],
  [-96.91480, 19.53205],
  [-96.91361, 19.53077],
  [-96.91242, 19.52949],
  [-96.91123, 19.52821],
  [-96.91004, 19.52693],
  [-96.90885, 19.52565],
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
async function importRoutes82_83_84() {
  try {
    console.log('Importando ruta 82...');
    await createRoute(82, route82Coordinates);
    
    console.log('Importando ruta 83...');
    await createRoute(83, route83Coordinates);
    
    console.log('Importando ruta 84...');
    await createRoute(84, route84Coordinates);
    
    console.log('Importación completada con éxito.');
  } catch (error) {
    console.error('Error durante la importación:', error);
  }
}

// Ejecutar la función principal
importRoutes82_83_84().catch(console.error);