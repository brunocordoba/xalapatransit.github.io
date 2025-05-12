import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getUniqueRouteColor } from "../client/src/lib/constants";

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

  const httpServer = createServer(app);
  return httpServer;
}
