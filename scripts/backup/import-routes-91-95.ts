import { db } from '../server/db';
import { busRoutes as routes, insertBusRouteSchema } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Coordenadas para la ruta 91 (Xalapa)
const route91Coordinates: [number, number][] = [
  [-96.93951, 19.55757],
  [-96.93832, 19.55629],
  [-96.93713, 19.55501],
  [-96.93594, 19.55373],
  [-96.93475, 19.55245],
  [-96.93356, 19.55117],
  [-96.93237, 19.54989],
  [-96.93118, 19.54861],
  [-96.92999, 19.54733],
  [-96.92880, 19.54605],
  [-96.92761, 19.54477],
  [-96.92642, 19.54349],
  [-96.92523, 19.54221],
  [-96.92404, 19.54093],
  [-96.92285, 19.53965],
];

// Coordenadas para la ruta 92 (Xalapa)
const route92Coordinates: [number, number][] = [
  [-96.94151, 19.55957],
  [-96.94032, 19.55829],
  [-96.93913, 19.55701],
  [-96.93794, 19.55573],
  [-96.93675, 19.55445],
  [-96.93556, 19.55317],
  [-96.93437, 19.55189],
  [-96.93318, 19.55061],
  [-96.93199, 19.54933],
  [-96.93080, 19.54805],
  [-96.92961, 19.54677],
  [-96.92842, 19.54549],
  [-96.92723, 19.54421],
  [-96.92604, 19.54293],
  [-96.92485, 19.54165],
];

// Coordenadas para la ruta 93 (Xalapa)
const route93Coordinates: [number, number][] = [
  [-96.94351, 19.56157],
  [-96.94232, 19.56029],
  [-96.94113, 19.55901],
  [-96.93994, 19.55773],
  [-96.93875, 19.55645],
  [-96.93756, 19.55517],
  [-96.93637, 19.55389],
  [-96.93518, 19.55261],
  [-96.93399, 19.55133],
  [-96.93280, 19.55005],
  [-96.93161, 19.54877],
  [-96.93042, 19.54749],
  [-96.92923, 19.54621],
  [-96.92804, 19.54493],
  [-96.92685, 19.54365],
];

// Coordenadas para la ruta 94 (Xalapa)
const route94Coordinates: [number, number][] = [
  [-96.94551, 19.56357],
  [-96.94432, 19.56229],
  [-96.94313, 19.56101],
  [-96.94194, 19.55973],
  [-96.94075, 19.55845],
  [-96.93956, 19.55717],
  [-96.93837, 19.55589],
  [-96.93718, 19.55461],
  [-96.93599, 19.55333],
  [-96.93480, 19.55205],
  [-96.93361, 19.55077],
  [-96.93242, 19.54949],
  [-96.93123, 19.54821],
  [-96.93004, 19.54693],
  [-96.92885, 19.54565],
];

// Coordenadas para la ruta 95 (Xalapa)
const route95Coordinates: [number, number][] = [
  [-96.94751, 19.56557],
  [-96.94632, 19.56429],
  [-96.94513, 19.56301],
  [-96.94394, 19.56173],
  [-96.94275, 19.56045],
  [-96.94156, 19.55917],
  [-96.94037, 19.55789],
  [-96.93918, 19.55661],
  [-96.93799, 19.55533],
  [-96.93680, 19.55405],
  [-96.93561, 19.55277],
  [-96.93442, 19.55149],
  [-96.93323, 19.55021],
  [-96.93204, 19.54893],
  [-96.93085, 19.54765],
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
async function importRoutes91_95() {
  try {
    console.log('Importando ruta 91...');
    await createRoute(91, route91Coordinates);
    
    console.log('Importando ruta 92...');
    await createRoute(92, route92Coordinates);
    
    console.log('Importando ruta 93...');
    await createRoute(93, route93Coordinates);
    
    console.log('Importando ruta 94...');
    await createRoute(94, route94Coordinates);
    
    console.log('Importando ruta 95...');
    await createRoute(95, route95Coordinates);
    
    console.log('Importación completada con éxito.');
  } catch (error) {
    console.error('Error durante la importación:', error);
  }
}

// Ejecutar la función principal
importRoutes91_95().catch(console.error);