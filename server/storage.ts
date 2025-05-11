import { BusRoute, BusStop, busRoutes, busStops, type InsertBusRoute, type InsertBusStop } from "@shared/schema";
import { mockRoutes } from "./data/routes";
import { db } from "./db";
import { eq } from "drizzle-orm";

// Interface for storage operations
export interface IStorage {
  getAllRoutes(): Promise<BusRoute[]>;
  getRoute(id: number): Promise<BusRoute | undefined>;
  getRoutesByZone(zone: string): Promise<BusRoute[]>;
  getStopsByRouteId(routeId: number): Promise<BusStop[]>;
  createRoute(route: InsertBusRoute): Promise<BusRoute>;
  createStop(stop: InsertBusStop): Promise<BusStop>;
  initializeData(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getAllRoutes(): Promise<BusRoute[]> {
    const routes = await db.select().from(busRoutes);
    
    // Ordenar rutas por el número secuencial en el nombre (1., 2., 3., etc.)
    return routes.sort((a, b) => {
      const numA = parseInt(a.name.split('.')[0]) || 0;
      const numB = parseInt(b.name.split('.')[0]) || 0;
      return numA - numB;
    });
  }

  async getRoute(id: number): Promise<BusRoute | undefined> {
    const result = await db.select().from(busRoutes).where(eq(busRoutes.id, id));
    return result.length > 0 ? result[0] : undefined;
  }

  async getRoutesByZone(zone: string): Promise<BusRoute[]> {
    let routes: BusRoute[];
    
    if (zone === 'all') {
      routes = await db.select().from(busRoutes);
    } else {
      routes = await db.select().from(busRoutes).where(eq(busRoutes.zone, zone));
    }
    
    // Ordenar rutas por el número secuencial en el nombre (1., 2., 3., etc.)
    return routes.sort((a, b) => {
      const numA = parseInt(a.name.split('.')[0]) || 0;
      const numB = parseInt(b.name.split('.')[0]) || 0;
      return numA - numB;
    });
  }

  async getStopsByRouteId(routeId: number): Promise<BusStop[]> {
    return await db.select().from(busStops).where(eq(busStops.routeId, routeId));
  }

  async createRoute(insertRoute: InsertBusRoute): Promise<BusRoute> {
    const result = await db.insert(busRoutes).values(insertRoute).returning();
    return result[0];
  }

  async createStop(insertStop: InsertBusStop): Promise<BusStop> {
    const result = await db.insert(busStops).values(insertStop).returning();
    return result[0];
  }

  async initializeData(): Promise<void> {
    // Check if data already exists
    const existingRoutes = await db.select().from(busRoutes);
    if (existingRoutes.length > 0) {
      console.log("Database already contains data. Skipping initialization.");
      return;
    }

    console.log("Initializing database with mock data...");

    // Load routes from mock data
    for (const routeData of mockRoutes) {
      const route = await this.createRoute(routeData);
      
      // Generate stops for each route
      if (routeData.geoJSON && (routeData.geoJSON as any).geometry && (routeData.geoJSON as any).geometry.coordinates) {
        const coordinates = (routeData.geoJSON as any).geometry.coordinates as [number, number][];
        
        // Create terminal stops at the beginning and end
        if (coordinates.length > 0) {
          // First terminal
          await this.createStop({
            routeId: route.id,
            name: `Terminal ${routeData.name.split('-')[0].trim()}`,
            latitude: coordinates[0][0].toString(),
            longitude: coordinates[0][1].toString(),
            isTerminal: true,
            terminalType: 'first'
          });
          
          // Add some intermediate stops (sample every n-th coordinate)
          const step = Math.max(1, Math.floor(coordinates.length / 8));
          for (let i = step; i < coordinates.length - step; i += step) {
            const stopName = `Parada ${i}`;
            await this.createStop({
              routeId: route.id,
              name: stopName,
              latitude: coordinates[i][0].toString(),
              longitude: coordinates[i][1].toString(),
              isTerminal: false,
              terminalType: ''
            });
          }
          
          // Last terminal
          if (coordinates.length > 1) {
            await this.createStop({
              routeId: route.id,
              name: `Terminal ${routeData.name.split('→')[1]?.trim() || 'Final'}`,
              latitude: coordinates[coordinates.length - 1][0].toString(),
              longitude: coordinates[coordinates.length - 1][1].toString(),
              isTerminal: true,
              terminalType: 'last'
            });
          }
        }
      }
    }

    console.log("Database initialization completed.");
  }
}

export const storage = new DatabaseStorage();
