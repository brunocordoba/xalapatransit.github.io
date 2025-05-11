import L from 'leaflet';
import { BusRoute, GeoJSONFeature } from '@shared/schema';

// Initialize the map
export function initializeMap(container: HTMLElement, center: [number, number], zoom: number): L.Map {
  const map = L.map(container, {
    zoomControl: false,
    attributionControl: true
  }).setView(center, zoom);
  
  // Carto Voyager map - mejor detalle de calles similar a Mapaton.org
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);
  
  // Alternativa: Mapbox Street (se requiere key)
  // L.tileLayer('https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles/{z}/{x}/{y}?access_token=YOUR_MAPBOX_ACCESS_TOKEN', {
  //   attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  //   maxZoom: 20
  // }).addTo(map);
  
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
      
      // Primero dibujar un borde blanco para simular el efecto de calles
      const routeOutline = L.polyline(leafletCoords, {
        color: 'white',
        weight: 10, // Más ancho para el borde
        opacity: 0.6,
        lineCap: 'round',
        lineJoin: 'round',
        smoothFactor: 0.5, // Menor suavizado para mejor seguimiento de calles
        className: 'route-outline',
      }).addTo(map);
      
      // Dibujar línea principal de la ruta exactamente como Mapaton.org
      const routeLine = L.polyline(leafletCoords, {
        color: route.color || '#3388ff',
        weight: 5, // Grosor adecuado
        opacity: 0.9, // Alta opacidad para mayor visibilidad
        lineCap: 'round', // Extremos redondeados
        lineJoin: 'round', // Uniones redondeadas
        smoothFactor: 0.5, // Menor suavizado para seguir mejor las calles
        className: 'route-line',
      }).addTo(map);
      
      // Añadir efecto de sombra para mayor profundidad y realismo
      const shadowLine = L.polyline(leafletCoords, {
        color: 'rgba(0,0,0,0.3)',
        weight: 12,
        opacity: 0.3,
        lineCap: 'round',
        lineJoin: 'round',
        smoothFactor: 0.5,
        className: 'route-shadow',
      }).addTo(map);
      
      // Asegurar el orden de las capas:
      // 1. Primero la sombra (abajo del todo)
      shadowLine.bringToBack();
      // 2. Luego el borde blanco
      routeOutline.bringToFront();
      // 3. Finalmente la línea de la ruta (visible por encima)
      routeLine.bringToFront();
      
      // Store reference to the layer
      layers[route.id] = routeLine;
      
      // Add click events to both the outline and the line
      routeLine.on('click', () => {
        console.log(`Ruta ${route.id} seleccionada`);
        onRouteClick(route.id);
      });
      
      routeOutline.on('click', () => {
        console.log(`Ruta ${route.id} seleccionada (desde borde)`);
        onRouteClick(route.id);
      });
      
      // Mejorar la interacción al pasar el ratón
      routeLine.on('mouseover', () => {
        if (!routeLine.options.className?.includes('hover')) {
          routeLine.setStyle({
            weight: 8,
            className: 'route-line hover'
          });
        }
      });
      
      routeLine.on('mouseout', () => {
        if (!layers[route.id].options.className?.includes('selected')) {
          routeLine.setStyle({
            weight: 6,
            className: 'route-line'
          });
        }
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
          weight: 6, 
          opacity: 0.7,
          className: 'route-line'
        });
        
        // Bring selected route to front and apply highlight style
        if (selectedRouteId !== null && routeId === selectedRouteId) {
          console.log(`Aplicando estilo destacado a la ruta ${routeId}`);
          
          // Estilo para la ruta seleccionada (exactamente como Mapaton.org)
          layer.setStyle({
            weight: 7, // Ligeramente más gruesa que las demás
            opacity: 1.0, // Completamente opaca
            dashArray: '',
            className: 'route-line selected',
            // Añadir un ligero resplandor para destacar más (esto se implementará con CSS)
          });
          
          // Agregar efecto de pulsación a la ruta seleccionada con CSS
          if (typeof layer.getElement === 'function') {
            const pathElement = layer.getElement();
            if (pathElement) {
              pathElement.classList.add('pulse-animation');
            }
          }
          
          if (typeof layer.bringToFront === 'function') {
            layer.bringToFront();
          }
          
          // Centrar el mapa en la ruta seleccionada con animación suave
          try {
            const bounds = layer.getBounds();
            if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
              map.fitBounds(bounds, {
                padding: [100, 100], // Más padding para mejor visualización
                maxZoom: 15,
                animate: true,
                duration: 0.5 // Animación rápida pero suave
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
