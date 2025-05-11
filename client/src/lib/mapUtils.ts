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
export function getBusStopIcon(isTerminal: boolean, color: string = '#ffffff'): L.DivIcon {
  const size = isTerminal ? 14 : 8;
  
  return L.divIcon({
    className: 'bus-stop-icon',
    html: `<div class="w-full h-full rounded-full bg-white shadow-md border-2" style="border-color: ${isTerminal ? color : 'white'}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2]
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
      
      if (!geoJSON) {
        console.warn(`La ruta ${route.id} (${route.name}) no tiene datos GeoJSON`);
        return;
      }
      
      let coordinates: [number, number][] = [];
      
      // Manejar diferentes formatos de GeoJSON
      if (geoJSON.type === 'Feature' && geoJSON.geometry && geoJSON.geometry.type === 'LineString') {
        // Formato estándar de GeoJSON
        coordinates = geoJSON.geometry.coordinates;
      } else if (geoJSON.geometry && geoJSON.geometry.coordinates) {
        // Formato simplificado
        coordinates = geoJSON.geometry.coordinates;
      } else if (geoJSON.coordinates) {
        // Formato más simplificado
        coordinates = geoJSON.coordinates;
      } else if (Array.isArray(geoJSON)) {
        // Si GeoJSON es directamente un array de coordenadas
        coordinates = geoJSON;
      } else {
        console.warn(`Formato GeoJSON no reconocido para la ruta ${route.id}:`, geoJSON);
        return;
      }
      
      // Validar que hay coordenadas y que son válidas
      if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
        console.warn(`La ruta ${route.id} no tiene suficientes coordenadas válidas`, coordinates);
        return;
      }
      
      // Asegurarse de que las coordenadas están en el formato correcto para Leaflet [lat, lng]
      // Leaflet espera [lat, lng] pero GeoJSON tiene [lng, lat]
      const leafletCoords = coordinates.map(coord => {
        // Si las coordenadas están invertidas, invertirlas aquí
        if (typeof coord[0] === 'number' && typeof coord[1] === 'number') {
          // GeoJSON utiliza [longitud, latitud] pero Leaflet usa [latitud, longitud]
          return [coord[1], coord[0]] as [number, number];
        }
        return coord;
      });
      
      // Debug
      console.log(`Dibujando ruta ${route.id} con ${leafletCoords.length} puntos`);
      
      // Draw the route line
      const routeLine = L.polyline(leafletCoords, {
        color: route.color || '#3388ff',
        weight: 5,
        opacity: 0.7
      }).addTo(map);
      
      // Store reference to the layer
      layers[route.id] = routeLine;
      
      // Add click event to the route
      routeLine.on('click', () => {
        console.log(`Ruta ${route.id} seleccionada`);
        onRouteClick(route.id);
      });
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
  try {
    console.log(`Resaltando ruta ${selectedRouteId}, hay ${Object.keys(layers).length} capas disponibles`);
    
    // Reset all routes to default style
    Object.entries(layers).forEach(([id, layer]) => {
      if (!layer) {
        console.warn(`Capa para ruta ${id} es nula o indefinida`);
        return;
      }
      
      try {
        const routeId = parseInt(id);
        
        // Estilo predeterminado para rutas no seleccionadas
        layer.setStyle({
          weight: 5,
          opacity: 0.7,
          dashArray: ''
        });
        
        // Bring selected route to front and apply highlight style
        if (selectedRouteId !== null && routeId === selectedRouteId) {
          console.log(`Aplicando estilo destacado a la ruta ${routeId}`);
          
          // Estilo para la ruta seleccionada
          layer.setStyle({
            weight: 10,
            opacity: 1.0,
            dashArray: ''
          });
          
          if (typeof layer.bringToFront === 'function') {
            layer.bringToFront();
          }
          
          // Opcionalmente, centrar el mapa en la ruta seleccionada
          try {
            const bounds = layer.getBounds();
            if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
              map.fitBounds(bounds, {
                padding: [50, 50],
                maxZoom: 15
              });
            }
          } catch (boundError) {
            console.warn('No se pudo centrar en la ruta:', boundError);
          }
        }
      } catch (styleError) {
        console.error(`Error al aplicar estilo a ruta ${id}:`, styleError);
      }
    });
  } catch (error) {
    console.error('Error al resaltar ruta:', error);
  }
}

// Add bus stops to the map
export function addBusStops(
  map: L.Map, 
  routeId: number,
  stops: Array<{
    latitude: string;
    longitude: string;
    isTerminal: boolean;
    name: string;
  }>,
  color: string
): L.Marker[] {
  const markers: L.Marker[] = [];
  
  stops.forEach((stop) => {
    const isTerminal = stop.isTerminal;
    const icon = getBusStopIcon(isTerminal, color);
    const lat = parseFloat(stop.latitude);
    const lng = parseFloat(stop.longitude);
    
    if (isNaN(lat) || isNaN(lng)) {
      console.warn(`Coordenadas inválidas para parada ${stop.name}: ${stop.latitude}, ${stop.longitude}`);
      return;
    }
    
    const marker = L.marker([lat, lng], { icon }).addTo(map);
    
    // Agregar popup con información de la parada
    marker.bindPopup(`
      <div class="text-sm font-medium">
        <div class="font-bold">${stop.name}</div>
        <div class="text-xs text-gray-600">Ruta ID: ${routeId}</div>
      </div>
    `);
    
    markers.push(marker);
  });
  
  return markers;
}
