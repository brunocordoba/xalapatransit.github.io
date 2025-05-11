import L from 'leaflet';
import { BusRoute, GeoJSONFeature } from '@shared/schema';

// Initialize the map
export function initializeMap(container: HTMLElement, center: [number, number], zoom: number): L.Map {
  const map = L.map(container).setView(center, zoom);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  
  return map;
}

// Get bus stop icon
export function getBusStopIcon(isTerminal: boolean, color: string): L.DivIcon {
  const size = isTerminal ? 10 : 6;
  const terminalClass = isTerminal ? 'border-2' : 'border';
  
  return L.divIcon({
    className: 'bus-stop-icon',
    html: `<div class="w-${size/2} h-${size/2} rounded-full bg-white ${terminalClass} border-gray-700" style="border-color: ${color}"></div>`,
    iconSize: [size, size]
  });
}

// Draw all routes on the map
export function drawRoutes(
  map: L.Map, 
  routes: BusRoute[], 
  onRouteClick: (routeId: number) => void
): { map: L.Map; layers: Record<number, L.Polyline> } {
  const layers: Record<number, L.Polyline> = {};
  
  routes.forEach(route => {
    try {
      const geoJSON = route.geoJSON as any;
      
      if (geoJSON && geoJSON.type === 'Feature' && geoJSON.geometry.type === 'LineString') {
        const coordinates = geoJSON.geometry.coordinates as [number, number][];
        
        // Draw the route line
        const routeLine = L.polyline(coordinates, {
          color: route.color,
          weight: 5,
          opacity: 0.7
        }).addTo(map);
        
        // Store reference to the layer
        layers[route.id] = routeLine;
        
        // Add click event to the route
        routeLine.on('click', () => {
          onRouteClick(route.id);
        });
      }
    } catch (error) {
      console.error(`Error drawing route ${route.id}:`, error);
    }
  });
  
  return { map, layers };
}

// Highlight selected route
export function highlightRoute(
  map: L.Map, 
  layers: Record<number, L.Polyline>, 
  selectedRouteId: number | null
): void {
  // Reset all routes to default style
  Object.entries(layers).forEach(([id, layer]) => {
    const routeId = parseInt(id);
    layer.setStyle({
      weight: 5,
      opacity: 0.7
    });
    
    // Bring selected route to front
    if (selectedRouteId !== null && routeId === selectedRouteId) {
      layer.setStyle({
        weight: 8,
        opacity: 0.9
      });
      layer.bringToFront();
    }
  });
}

// Add bus stops to the map
export function addBusStops(
  map: L.Map, 
  routeId: number,
  coordinates: [number, number][],
  color: string
): L.Marker[] {
  const markers: L.Marker[] = [];
  
  coordinates.forEach((coord, index) => {
    const isTerminal = index === 0 || index === coordinates.length - 1;
    const icon = getBusStopIcon(isTerminal, color);
    
    const marker = L.marker(coord, { icon }).addTo(map);
    markers.push(marker);
  });
  
  return markers;
}
