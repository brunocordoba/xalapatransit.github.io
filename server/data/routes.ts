import { InsertBusRoute } from "@shared/schema";

// Mock route data for Xalapa bus routes
export const mockRoutes: InsertBusRoute[] = [
  {
    name: "Ruta 1 - Centro → Animas",
    shortName: "R1",
    color: "#EF4444", // red-500
    frequency: "15 minutos",
    scheduleStart: "5:30 AM",
    scheduleEnd: "10:30 PM",
    stopsCount: 22,
    approximateTime: "45 minutos",
    zone: "centro",
    popular: true,
    geoJSON: {
      type: "Feature",
      properties: {
        id: 1,
        name: "Ruta 1 - Centro → Animas",
        shortName: "R1",
        color: "#EF4444"
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-96.9271, 19.53],
          [-96.9279, 19.535],
          [-96.929, 19.54],
          [-96.93, 19.545],
          [-96.928, 19.55]
        ]
      }
    }
  },
  {
    name: "Ruta 2 - Circunvalación",
    shortName: "R2",
    color: "#3B82F6", // blue-500
    frequency: "10 minutos",
    scheduleStart: "5:00 AM",
    scheduleEnd: "11:00 PM",
    stopsCount: 28,
    approximateTime: "50 minutos",
    zone: "sur",
    popular: true,
    geoJSON: {
      type: "Feature",
      properties: {
        id: 2,
        name: "Ruta 2 - Circunvalación",
        shortName: "R2",
        color: "#3B82F6"
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-96.92, 19.53],
          [-96.915, 19.535],
          [-96.912, 19.545],
          [-96.918, 19.55],
          [-96.925, 19.545],
          [-96.927, 19.535],
          [-96.92, 19.53]
        ]
      }
    }
  },
  {
    name: "Ruta 3 - Zona Universitaria",
    shortName: "R3",
    color: "#22C55E", // green-500
    frequency: "12 minutos",
    scheduleStart: "6:00 AM",
    scheduleEnd: "10:00 PM",
    stopsCount: 18,
    approximateTime: "35 minutos",
    zone: "este",
    popular: true,
    geoJSON: {
      type: "Feature",
      properties: {
        id: 3,
        name: "Ruta 3 - Zona Universitaria",
        shortName: "R3",
        color: "#22C55E"
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-96.93, 19.53],
          [-96.935, 19.525],
          [-96.94, 19.52],
          [-96.945, 19.525],
          [-96.947, 19.53]
        ]
      }
    }
  },
  {
    name: "Ruta 4 - Lomas Verdes",
    shortName: "R4",
    color: "#A855F7", // purple-500
    frequency: "20 minutos",
    scheduleStart: "5:30 AM",
    scheduleEnd: "9:30 PM",
    stopsCount: 15,
    approximateTime: "40 minutos",
    zone: "norte",
    popular: false,
    geoJSON: {
      type: "Feature",
      properties: {
        id: 4,
        name: "Ruta 4 - Lomas Verdes",
        shortName: "R4",
        color: "#A855F7"
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-96.935, 19.55],
          [-96.94, 19.555],
          [-96.945, 19.56],
          [-96.95, 19.565],
          [-96.955, 19.57]
        ]
      }
    }
  },
  {
    name: "Ruta 5 - Sumidero",
    shortName: "R5",
    color: "#EAB308", // yellow-500
    frequency: "25 minutos",
    scheduleStart: "6:00 AM",
    scheduleEnd: "9:00 PM",
    stopsCount: 20,
    approximateTime: "55 minutos",
    zone: "oeste",
    popular: false,
    geoJSON: {
      type: "Feature",
      properties: {
        id: 5,
        name: "Ruta 5 - Sumidero",
        shortName: "R5",
        color: "#EAB308"
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-96.92, 19.52],
          [-96.915, 19.515],
          [-96.91, 19.51],
          [-96.905, 19.505],
          [-96.9, 19.5]
        ]
      }
    }
  },
  {
    name: "Ruta 6 - Revolución",
    shortName: "R6",
    color: "#EC4899", // pink-500
    frequency: "15 minutos",
    scheduleStart: "5:00 AM",
    scheduleEnd: "10:00 PM",
    stopsCount: 24,
    approximateTime: "50 minutos",
    zone: "centro",
    popular: false,
    geoJSON: {
      type: "Feature",
      properties: {
        id: 6,
        name: "Ruta 6 - Revolución",
        shortName: "R6",
        color: "#EC4899"
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-96.925, 19.535],
          [-96.92, 19.54],
          [-96.915, 19.545],
          [-96.91, 19.55],
          [-96.905, 19.555]
        ]
      }
    }
  },
  {
    name: "Ruta 7 - Las Trancas",
    shortName: "R7",
    color: "#0EA5E9", // sky-500
    frequency: "30 minutos",
    scheduleStart: "6:00 AM",
    scheduleEnd: "9:00 PM",
    stopsCount: 16,
    approximateTime: "45 minutos",
    zone: "sur",
    popular: false,
    geoJSON: {
      type: "Feature",
      properties: {
        id: 7,
        name: "Ruta 7 - Las Trancas",
        shortName: "R7",
        color: "#0EA5E9"
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-96.915, 19.525],
          [-96.91, 19.52],
          [-96.905, 19.515],
          [-96.9, 19.51],
          [-96.895, 19.505]
        ]
      }
    }
  },
  {
    name: "Ruta 8 - Coapexpan",
    shortName: "R8",
    color: "#14B8A6", // teal-500
    frequency: "40 minutos",
    scheduleStart: "5:30 AM",
    scheduleEnd: "8:30 PM",
    stopsCount: 14,
    approximateTime: "35 minutos",
    zone: "oeste",
    popular: false,
    geoJSON: {
      type: "Feature",
      properties: {
        id: 8,
        name: "Ruta 8 - Coapexpan",
        shortName: "R8",
        color: "#14B8A6"
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-96.94, 19.535],
          [-96.945, 19.54],
          [-96.95, 19.545],
          [-96.955, 19.55],
          [-96.96, 19.555]
        ]
      }
    }
  }
];
