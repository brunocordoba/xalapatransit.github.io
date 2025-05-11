import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(app: Express): Promise<Server> {
  // API routes for bus routes
  app.get('/api/routes', async (req, res) => {
    try {
      const routes = await storage.getAllRoutes();
      res.json(routes);
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
      
      res.json(route);
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

  // API route for getting routes by zone
  app.get('/api/zones/:zone/routes', async (req, res) => {
    try {
      const zone = req.params.zone;
      const routes = await storage.getRoutesByZone(zone);
      res.json(routes);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
