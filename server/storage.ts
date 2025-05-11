import { BusRoute, BusStop, type InsertBusRoute, type InsertBusStop } from "@shared/schema";
import { mockRoutes } from "./data/routes";

// Interface for storage operations
export interface IStorage {
  getAllRoutes(): Promise<BusRoute[]>;
  getRoute(id: number): Promise<BusRoute | undefined>;
  getRoutesByZone(zone: string): Promise<BusRoute[]>;
  getStopsByRouteId(routeId: number): Promise<BusStop[]>;
  createRoute(route: InsertBusRoute): Promise<BusRoute>;
  createStop(stop: InsertBusStop): Promise<BusStop>;
}

export class MemStorage implements IStorage {
  private routes: Map<number, BusRoute>;
  private stops: Map<number, BusStop>;
  private routeIdCounter: number;
  private stopIdCounter: number;

  constructor() {
    this.routes = new Map();
    this.stops = new Map();
    this.routeIdCounter = 1;
    this.stopIdCounter = 1;
    
    // Initialize with mock data
    this.initializeMockData();
  }

  private initializeMockData() {
    // Load routes from mock data
    mockRoutes.forEach(routeData => {
      const route: BusRoute = {
        id: this.routeIdCounter++,
        ...routeData
      };
      this.routes.set(route.id, route);
      
      // Generate stops for each route
      if (routeData.geoJSON && (routeData.geoJSON as any).geometry && (routeData.geoJSON as any).geometry.coordinates) {
        const coordinates = (routeData.geoJSON as any).geometry.coordinates as [number, number][];
        
        // Create terminal stops at the beginning and end
        if (coordinates.length > 0) {
          // First terminal
          const firstStop: BusStop = {
            id: this.stopIdCounter++,
            routeId: route.id,
            name: `Terminal ${routeData.name.split('-')[0].trim()}`,
            latitude: coordinates[0][0].toString(),
            longitude: coordinates[0][1].toString(),
            isTerminal: true,
            terminalType: 'first'
          };
          this.stops.set(firstStop.id, firstStop);
          
          // Add some intermediate stops (sample every n-th coordinate)
          const step = Math.max(1, Math.floor(coordinates.length / 8));
          for (let i = step; i < coordinates.length - step; i += step) {
            const stopName = `Parada ${i}`;
            const stop: BusStop = {
              id: this.stopIdCounter++,
              routeId: route.id,
              name: stopName,
              latitude: coordinates[i][0].toString(),
              longitude: coordinates[i][1].toString(),
              isTerminal: false,
              terminalType: ''
            };
            this.stops.set(stop.id, stop);
          }
          
          // Last terminal
          if (coordinates.length > 1) {
            const lastStop: BusStop = {
              id: this.stopIdCounter++,
              routeId: route.id,
              name: `Terminal ${routeData.name.split('→')[1]?.trim() || 'Final'}`,
              latitude: coordinates[coordinates.length - 1][0].toString(),
              longitude: coordinates[coordinates.length - 1][1].toString(),
              isTerminal: true,
              terminalType: 'last'
            };
            this.stops.set(lastStop.id, lastStop);
          }
        }
      }
    });
  }

  async getAllRoutes(): Promise<BusRoute[]> {
    return Array.from(this.routes.values());
  }

  async getRoute(id: number): Promise<BusRoute | undefined> {
    return this.routes.get(id);
  }

  async getRoutesByZone(zone: string): Promise<BusRoute[]> {
    return Array.from(this.routes.values()).filter(route => 
      zone === 'all' || route.zone === zone
    );
  }

  async getStopsByRouteId(routeId: number): Promise<BusStop[]> {
    return Array.from(this.stops.values()).filter(stop => 
      stop.routeId === routeId
    );
  }

  async createRoute(insertRoute: InsertBusRoute): Promise<BusRoute> {
    const id = this.routeIdCounter++;
    const route: BusRoute = { ...insertRoute, id };
    this.routes.set(id, route);
    return route;
  }

  async createStop(insertStop: InsertBusStop): Promise<BusStop> {
    const id = this.stopIdCounter++;
    const stop: BusStop = { ...insertStop, id };
    this.stops.set(id, stop);
    return stop;
  }
}

export const storage = new MemStorage();
