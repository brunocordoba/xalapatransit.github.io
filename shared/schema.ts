import { pgTable, text, serial, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Define the schemas for our data models

export const busRoutes = pgTable("bus_routes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  color: text("color").notNull(),
  frequency: text("frequency").notNull(),
  scheduleStart: text("schedule_start").notNull(),
  scheduleEnd: text("schedule_end").notNull(),
  stopsCount: integer("stops_count").notNull(),
  approximateTime: text("approximate_time").notNull(),
  zone: text("zone").notNull(),
  popular: boolean("popular").default(false),
  geoJSON: jsonb("geo_json").notNull(),
});

export const busStops = pgTable("bus_stops", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull(),
  name: text("name").notNull(),
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  isTerminal: boolean("is_terminal").default(false),
  terminalType: text("terminal_type").default(""),
});

// Create schemas for inserts
export const insertBusRouteSchema = createInsertSchema(busRoutes).omit({
  id: true,
});

export const insertBusStopSchema = createInsertSchema(busStops).omit({
  id: true,
});

// Create types
export type BusRoute = typeof busRoutes.$inferSelect;
export type InsertBusRoute = z.infer<typeof insertBusRouteSchema>;

export type BusStop = typeof busStops.$inferSelect;
export type InsertBusStop = z.infer<typeof insertBusStopSchema>;

// Define GeoJSON types for the front-end
export type GeoJSONFeature = {
  type: "Feature";
  properties: {
    id: number;
    name: string;
    shortName: string;
    color: string;
  };
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
};

export type GeoJSONCollection = {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
};

// Define types for stops
export type StopPoint = {
  id: number;
  routeId: number;
  name: string;
  coordinates: [number, number];
  isTerminal: boolean;
  terminalType: string;
};
