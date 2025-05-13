import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getUniqueRouteColor } from "../client/src/lib/constants";
import type { BusStop } from "../shared/schema";
import { PlanCoordinates, planRoute } from "./algorithms/pathFinder";

export async function registerRoutes(app: Express): Promise<Server> {
  // API routes for bus routes
  app.get('/api/routes', async (req, res) => {
    try {
      const routes = await storage.getAllRoutes();
      
      // Asignar colores únicos a cada ruta
      const routesWithUniqueColors = routes.map(route => ({
        ...route,
        color: getUniqueRouteColor(route.id, route.zone)
      }));
      
      res.json(routesWithUniqueColors);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message });
    }
  });

  // API route for getting a specific route by ID
  app.get('/api/routes/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid route ID' });
      }
      
      const route = await storage.getRoute(id);
      if (!route) {
        return res.status(404).json({ message: 'Route not found' });
      }
      
      // Asignar color único a la ruta
      const routeWithUniqueColor = {
        ...route,
        color: getUniqueRouteColor(route.id, route.zone)
      };
      
      res.json(routeWithUniqueColor);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message });
    }
  });

  // API route for getting bus stops by route ID
  app.get('/api/routes/:id/stops', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid route ID' });
      }
      
      const stops = await storage.getStopsByRouteId(id);
      res.json(stops);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message });
    }
  });
  
  // API route for updating a route (for manual corrections)
  app.patch('/api/routes/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid route ID' });
      }
      
      // Get the updates from the request body
      const updates = req.body;
      
      // Update the route
      const updatedRoute = await storage.updateRoute(id, updates);
      if (!updatedRoute) {
        return res.status(404).json({ message: 'Route not found' });
      }
      
      // Assign unique color
      const routeWithUniqueColor = {
        ...updatedRoute,
        color: getUniqueRouteColor(updatedRoute.id, updatedRoute.zone)
      };
      
      res.json(routeWithUniqueColor);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message });
    }
  });

  // API route for getting routes by zone
  app.get('/api/zones/:zone/routes', async (req, res) => {
    try {
      const zone = req.params.zone;
      const routes = await storage.getRoutesByZone(zone);
      
      // Asignar colores únicos a cada ruta
      const routesWithUniqueColors = routes.map(route => ({
        ...route,
        color: getUniqueRouteColor(route.id, route.zone)
      }));
      
      res.json(routesWithUniqueColors);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message });
    }
  });

  // API endpoint para planificación de rutas
  app.post('/api/plan-route', async (req, res) => {
    try {
      const { from, to, departureTime, arrivalTime, isArrival } = req.body;
      
      if (!from || !to) {
        return res.status(400).json({ message: 'Se requieren ubicaciones de origen y destino' });
      }
      
      // Extraer las coordenadas
      const originLat = parseFloat(from.latitude || from.lat);
      const originLng = parseFloat(from.longitude || from.lng);
      const destinationLat = parseFloat(to.latitude || to.lat);
      const destinationLng = parseFloat(to.longitude || to.lng);
      
      // Validar coordenadas
      if (isNaN(originLat) || isNaN(originLng) || isNaN(destinationLat) || isNaN(destinationLng)) {
        return res.status(400).json({ message: 'Coordenadas inválidas' });
      }
      
      // Configurar coordenadas para el planificador
      const planCoordinates: PlanCoordinates = {
        originLat,
        originLng,
        destinationLat,
        destinationLng
      };
      
      // Obtener todas las rutas y paradas
      const routes = await storage.getAllRoutes();
      const stops = await storage.getAllStops();
      
      // Calcular hora de salida
      let startTime = new Date();
      if (departureTime) {
        const [hours, minutes] = departureTime.split(':').map(Number);
        startTime.setHours(hours, minutes, 0);
      }
      
      console.log(`Planificando ruta desde [${originLat}, ${originLng}] hasta [${destinationLat}, ${destinationLng}]`);
      
      // Usar nuestro algoritmo de planificación
      const results = await planRoute(
        planCoordinates,
        stops,
        routes,
        startTime,
        3 // Máximo 3 resultados
      );
      
      if (results.length === 0) {
        return res.status(404).json({ message: 'No se encontraron rutas entre los puntos especificados' });
      }
      
      res.json(results);
    } catch (error) {
      console.error('Error al planificar ruta:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message });
    }
  });

  // API endpoint para encontrar paradas cercanas
  app.post('/api/nearby-stops', async (req, res) => {
    try {
      const { latitude, longitude, maxDistance = 2000 } = req.body; // maxDistance en metros, default 2km
      
      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return res.status(400).json({ message: 'Se requieren coordenadas de ubicación válidas (latitude y longitude como números)' });
      }
      
      // Obtener todas las paradas
      const allStops = await storage.getAllStops();
      
      // Calcular distancia entre las coordenadas proporcionadas y cada parada
      const nearbyStops = allStops
        .map(stop => {
          // Calcular distancia Haversine entre puntos
          // Si la parada no tiene location, usar latitude/longitude
          let stopCoords: [number, number];
          if (stop.location && typeof stop.location === 'object' && 'coordinates' in stop.location) {
            stopCoords = stop.location.coordinates as [number, number];
          } else {
            stopCoords = [parseFloat(stop.longitude), parseFloat(stop.latitude)];
          }
          
          const distance = haversineDistance(
            longitude, latitude,  // [long, lat] del usuario
            stopCoords[0], stopCoords[1]  // [long, lat] de la parada
          );
          
          return {
            ...stop,
            coordinates: stopCoords,
            distance: Math.round(distance)  // Redondear a metros enteros
          };
        })
        .filter(stop => stop.distance <= maxDistance)  // Filtrar solo paradas dentro del radio
        .sort((a, b) => a.distance - b.distance);  // Ordenar por cercanía
      
      // Obtener información de las rutas que pasan por estas paradas
      const nearbyRouteIdsSet = new Set(nearbyStops.map(stop => stop.routeId));
      const nearbyRouteIds = Array.from(nearbyRouteIdsSet);
      const routeDetails = await Promise.all(
        nearbyRouteIds.map(async (routeId) => {
          const route = await storage.getRoute(routeId);
          return route ? {
            id: route.id,
            name: route.name,
            shortName: route.shortName,
            color: getUniqueRouteColor(route.id, route.zone)
          } : null;
        })
      );
      
      // Eliminar null values
      const filteredRouteDetails = routeDetails.filter(r => r !== null);
      
      res.json({
        stops: nearbyStops.map(stop => ({
          id: stop.id,
          name: stop.name,
          routeId: stop.routeId,
          coordinates: stop.coordinates,
          distance: stop.distance
        })),
        routes: filteredRouteDetails
      });
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

// Función para calcular la distancia entre dos puntos geográficos usando la fórmula Haversine
function haversineDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371000; // Radio de la Tierra en metros
  
  // Convertir a radianes
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distancia en metros
}

function toRad(degrees: number): number {
  return degrees * Math.PI / 180;
}

// Función auxiliar para calcular la hora de finalización basada en una hora de inicio y duración
function calculateEndTime(startTime: string, durationMinutes: number, subtract = false): string {
  const [hours, minutes] = startTime.split(':').map(Number);
  let totalMinutes = hours * 60 + minutes;
  
  if (subtract) {
    totalMinutes -= durationMinutes;
  } else {
    totalMinutes += durationMinutes;
  }
  
  // Ajustar si es necesario (por ejemplo, si hay desbordamiento de 24 horas)
  while (totalMinutes < 0) totalMinutes += 24 * 60;
  totalMinutes = totalMinutes % (24 * 60);
  
  const newHours = Math.floor(totalMinutes / 60);
  const newMinutes = totalMinutes % 60;
  
  return `${newHours.toString().padStart(2, '0')}:${newMinutes.toString().padStart(2, '0')}`;
}

// Función para obtener una parada aleatoria
function getRandomStop(stops: BusStop[]): BusStop | undefined {
  if (!stops || stops.length === 0) return undefined;
  const randomIndex = Math.floor(Math.random() * stops.length);
  return stops[randomIndex];
}
