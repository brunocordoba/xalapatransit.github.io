import { BusRoute, BusStop, BusStopLocation, busRoutes, busStops, type InsertBusRoute, type InsertBusStop } from "@shared/schema";
import { mockRoutes } from "./data/routes";
import { db } from "./db";
import { eq } from "drizzle-orm";

// Interface for storage operations
export interface IStorage {
  getAllRoutes(): Promise<BusRoute[]>;
  getRoute(id: number): Promise<BusRoute | undefined>;
  getRoutesByZone(zone: string): Promise<BusRoute[]>;
  getStopsByRouteId(routeId: number): Promise<BusStop[]>;
  getAllStops(): Promise<BusStop[]>;
  createRoute(route: InsertBusRoute): Promise<BusRoute>;
  createStop(stop: InsertBusStop): Promise<BusStop>;
  updateRoute(id: number, updates: Partial<BusRoute>): Promise<BusRoute | undefined>;
  updateStopLocation(id: number): Promise<BusStop | undefined>;
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
  
  async getAllStops(): Promise<BusStop[]> {
    return await db.select().from(busStops);
  }

  async createRoute(insertRoute: InsertBusRoute): Promise<BusRoute> {
    const result = await db.insert(busRoutes).values(insertRoute).returning();
    return result[0];
  }

  async createStop(insertStop: InsertBusStop): Promise<BusStop> {
    // Crear un objeto de ubicación GeoJSON para la parada
    const location: BusStopLocation = {
      type: "Point",
      coordinates: [
        parseFloat(insertStop.longitude), 
        parseFloat(insertStop.latitude)
      ]
    };
    
    // Añadir la ubicación al objeto de parada
    const stopWithLocation = {
      ...insertStop,
      location
    };
    
    const result = await db.insert(busStops).values(stopWithLocation).returning();
    return result[0];
  }
  
  async updateRoute(id: number, updates: Partial<BusRoute>): Promise<BusRoute | undefined> {
    // Primero verificamos si la ruta existe
    const existingRoute = await this.getRoute(id);
    if (!existingRoute) {
      return undefined;
    }
    
    // Realizamos la actualización
    const result = await db.update(busRoutes)
      .set(updates)
      .where(eq(busRoutes.id, id))
      .returning();
    
    return result.length > 0 ? result[0] : undefined;
  }
  
  async updateStopLocation(id: number): Promise<BusStop | undefined> {
    // Obtener la parada existente
    const [existingStop] = await db.select().from(busStops).where(eq(busStops.id, id));
    if (!existingStop) {
      return undefined;
    }
    
    // Crear un objeto de ubicación GeoJSON para la parada
    const location: BusStopLocation = {
      type: "Point",
      coordinates: [
        parseFloat(existingStop.longitude), 
        parseFloat(existingStop.latitude)
      ]
    };
    
    // Actualizar la parada con la ubicación
    const result = await db.update(busStops)
      .set({ location })
      .where(eq(busStops.id, id))
      .returning();
    
    return result.length > 0 ? result[0] : undefined;
  }

  async initializeData(): Promise<void> {
    // ¡IMPORTANTE! Inicialización de datos desactivada para evitar rutas duplicadas.
    // Las rutas se cargarán exclusivamente mediante el script de importación
    
    console.log("Database initialization skipped to prevent duplicate routes.");
    return;
  }
}

export const storage = new DatabaseStorage();
