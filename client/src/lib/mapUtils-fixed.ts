import L from 'leaflet';
import { BusRoute, GeoJSONFeature } from '@shared/schema';

// Clase para agrupar las capas de una ruta
export class RouteLayers {
  constructor(
    public route: L.Polyline,
    public outline: L.Polyline,
    public shadow: L.Polyline
  ) {}
  
  bringToFront() {
    this.shadow.bringToBack();
    this.outline.bringToFront();
    this.route.bringToFront();
  }
  
  remove() {
    this.route.remove();
    this.outline.remove();
    this.shadow.remove();
  }
}

// Initialize the map
export function initializeMap(container: HTMLElement, center: [number, number], zoom: number): L.Map {
  const map = L.map(container, {
    zoomControl: false,
    attributionControl: true
  }).setView(center, zoom);
  
  // Usar Mapbox como proveedor de mapas base (exactamente como Mapaton)
  const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';
  
  if (mapboxToken) {
    // Si tenemos un token de Mapbox, usamos sus mapas de alta calidad
    L.tileLayer('https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles/{z}/{x}/{y}?access_token=' + mapboxToken, {
      attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 20,
      tileSize: 512,
      zoomOffset: -1
    }).addTo(map);
  } else {
    // Fallback a Carto si no hay token de Mapbox
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);
  }
  
  return map;
}

// Get bus stop icon
export function getBusStopIcon(isTerminal: boolean | null, color: string = '#ffffff'): L.DivIcon {
  // En caso de que isTerminal sea null, tratarlo como false
  const isActuallyTerminal = isTerminal === true;
  const size = isActuallyTerminal ? 14 : 8;
  
  return L.divIcon({
    className: 'bus-stop-icon',
    html: `<div class="w-full h-full rounded-full bg-white shadow-md border-2" style="border-color: ${isActuallyTerminal ? color : 'white'}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2]
  });
}

// Draw all routes on the map
export function drawRoutes(
  map: L.Map, 
  routes: BusRoute[], 
  onRouteClick: (routeId: number) => void
): { map: L.Map; layers: Record<number, RouteLayers> } {
  const layers: Record<number, RouteLayers> = {};
  
  // Limpiar todas las rutas existentes
  Object.values(layers).forEach(layer => {
    if (layer) layer.remove();
  });
  
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
      
      // 1. Dibujar la sombra (capa inferior)
      const shadowLine = L.polyline(leafletCoords, {
        color: 'rgba(0,0,0,0.3)',
        weight: 12,
        opacity: 0.3,
        lineCap: 'round',
        lineJoin: 'round',
        smoothFactor: 0.5,
        className: 'route-shadow',
      }).addTo(map);
      
      // 2. Dibujar el borde blanco (capa intermedia)
      const routeOutline = L.polyline(leafletCoords, {
        color: 'white',
        weight: 10,
        opacity: 0.6,
        lineCap: 'round',
        lineJoin: 'round',
        smoothFactor: 0.5,
        className: 'route-outline',
      }).addTo(map);
      
      // 3. Dibujar la línea de la ruta (capa superior)
      const routeLine = L.polyline(leafletCoords, {
        color: route.color || '#3388ff',
        weight: 5,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
        smoothFactor: 0.5,
        className: 'route-line',
      }).addTo(map);
      
      // Asegurar el orden correcto de las capas
      shadowLine.bringToBack();
      routeOutline.bringToFront();
      routeLine.bringToFront();
      
      // Crear y almacenar la instancia de RouteLayers
      const routeLayers = new RouteLayers(routeLine, routeOutline, shadowLine);
      layers[route.id] = routeLayers;
      
      // Agregar eventos de clic a todas las capas
      routeLine.on('click', () => {
        console.log(`Ruta ${route.id} seleccionada`);
        onRouteClick(route.id);
      });
      
      routeOutline.on('click', () => {
        console.log(`Ruta ${route.id} seleccionada (desde borde)`);
        onRouteClick(route.id);
      });
      
      shadowLine.on('click', () => {
        console.log(`Ruta ${route.id} seleccionada (desde sombra)`);
        onRouteClick(route.id);
      });
      
      // Mejorar la interacción al pasar el ratón
      routeLine.on('mouseover', () => {
        if (!routeLine.options.className?.includes('hover')) {
          routeLine.setStyle({
            weight: 7,
            className: 'route-line hover'
          });
        }
      });
      
      routeLine.on('mouseout', () => {
        if (routeLine.options.className?.includes('hover') && 
            !routeLine.options.className?.includes('selected')) {
          routeLine.setStyle({
            weight: 5,
            className: 'route-line'
          });
        }
      });
    } catch (error) {
      console.error(`Error al dibujar la ruta ${route.id}:`, error);
    }
  });
  
  return { map, layers };
}

// Highlight selected route
export function highlightRoute(
  map: L.Map, 
  layers: Record<number, RouteLayers>, 
  selectedRouteId: number | null
): void {
  try {
    console.log(`Resaltando ruta ${selectedRouteId}, hay ${Object.keys(layers).length} capas disponibles`);
    
    // Reset all routes to default style
    Object.entries(layers).forEach(([id, routeLayers]) => {
      if (!routeLayers) {
        console.warn(`Capas para ruta ${id} son nulas o indefinidas`);
        return;
      }
      
      try {
        const routeId = parseInt(id);
        const { route, outline, shadow } = routeLayers;
        
        // Estilo predeterminado para rutas no seleccionadas
        route.setStyle({
          weight: 5, 
          opacity: 0.9,
          className: 'route-line'
        });
        
        outline.setStyle({
          weight: 10,
          opacity: 0.6,
          className: 'route-outline'
        });
        
        shadow.setStyle({
          weight: 12,
          opacity: 0.3,
          className: 'route-shadow'
        });
        
        // Verificar si esta es la ruta seleccionada
        if (selectedRouteId !== null && routeId === selectedRouteId) {
          console.log(`Aplicando estilo destacado a la ruta ${routeId}`);
          
          // Estilo para la ruta seleccionada
          route.setStyle({
            weight: 7, 
            opacity: 1.0,
            className: 'route-line selected',
          });
          
          outline.setStyle({
            weight: 14,
            opacity: 0.7,
            className: 'route-outline selected'
          });
          
          shadow.setStyle({
            weight: 16,
            opacity: 0.4,
            className: 'route-shadow selected'
          });
          
          // Asegurar el orden correcto de las capas
          routeLayers.bringToFront();
          
          // Centrar el mapa en la ruta seleccionada con animación suave
          try {
            const bounds = route.getBounds();
            if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
              map.fitBounds(bounds, {
                padding: [100, 100],
                maxZoom: 15,
                animate: true,
                duration: 0.5
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
    isTerminal: boolean | null;
    name: string;
    [key: string]: any; // Permitir otras propiedades
  }>,
  color: string
): L.Marker[] {
  const markers: L.Marker[] = [];
  
  stops.forEach((stop) => {
    // Asegurar que isTerminal es un booleano
    const isTerminal = stop.isTerminal === true;
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
        ${stop.terminalType ? `<div class="text-xs">${stop.terminalType === 'first' ? 'Terminal de origen' : 'Terminal de destino'}</div>` : ''}
      </div>
    `);
    
    markers.push(marker);
  });
  
  return markers;
}