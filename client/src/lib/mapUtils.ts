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

// Get bus stop icon - Estilo Mapaton
export function getBusStopIcon(isTerminal: boolean | null, color: string = '#ffffff'): L.DivIcon {
  // En caso de que isTerminal sea null, tratarlo como false
  const isActuallyTerminal = isTerminal === true;
  
  // Tamaños según Mapaton
  const size = isActuallyTerminal ? 18 : 12;
  
  // HTML para el icono de la parada de autobús
  // Estilo exactamente como en Mapaton: puntos blancos con borde del color de la ruta
  const borderColor = isActuallyTerminal ? color : 'rgba(0,0,0,0.5)';
  const borderWidth = isActuallyTerminal ? 3 : 2;
  
  return L.divIcon({
    className: 'bus-stop-icon',
    html: `
      <div 
        class="rounded-full bg-white shadow-xl" 
        style="
          width: ${size}px; 
          height: ${size}px; 
          border: ${borderWidth}px solid ${borderColor};
          box-shadow: 0 0 8px rgba(0,0,0,0.4);
        "
      ></div>
    `,
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
  
  // Usamos un grupo de capas para mejor rendimiento
  const routeLayerGroup = L.layerGroup().addTo(map);
  
  // Procesamos las rutas en bloques para evitar bloquear el hilo principal
  const processRoutesInBatches = (routes: BusRoute[], batchSize: number = 20, startIndex: number = 0) => {
    if (startIndex >= routes.length) return;
    
    const endIndex = Math.min(startIndex + batchSize, routes.length);
    const batch = routes.slice(startIndex, endIndex);
    
    batch.forEach(route => {
      try {
        const geoJSON = route.geoJSON as any;
        
        if (!geoJSON) {
          console.warn(`La ruta ${route.id} (${route.name}) no tiene datos GeoJSON`);
          return;
        }
        
        let coordinates: [number, number][] = [];
        
        // Manejar diferentes formatos de GeoJSON
        if (geoJSON.type === 'Feature' && geoJSON.geometry && geoJSON.geometry.type === 'LineString') {
          coordinates = geoJSON.geometry.coordinates;
        } else if (geoJSON.geometry && geoJSON.geometry.coordinates) {
          coordinates = geoJSON.geometry.coordinates;
        } else if (geoJSON.coordinates) {
          coordinates = geoJSON.coordinates;
        } else if (Array.isArray(geoJSON)) {
          coordinates = geoJSON;
        } else {
          console.warn(`Formato GeoJSON no reconocido para la ruta ${route.id}`);
          return;
        }
        
        // Validar que hay coordenadas y que son válidas
        if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
          console.warn(`La ruta ${route.id} no tiene suficientes coordenadas válidas`);
          return;
        }
        
        // Simplificar la geometría para mejorar el rendimiento
        // Reducir el número de puntos en rutas largas (más de 100 puntos)
        let simplifiedCoords = coordinates;
        if (coordinates.length > 100) {
          // Aplicar una simplificación básica manteniendo los puntos clave
          const step = Math.max(1, Math.floor(coordinates.length / 100));
          simplifiedCoords = coordinates.filter((_, i) => i % step === 0 || i === 0 || i === coordinates.length - 1);
        }
        
        // Convertir coordenadas a formato Leaflet [lat, lng]
        const leafletCoords = simplifiedCoords.map(coord => {
          if (typeof coord[0] === 'number' && typeof coord[1] === 'number') {
            return [coord[1], coord[0]] as [number, number];
          }
          return coord;
        });
        
        console.log(`Dibujando ruta ${route.id} con ${leafletCoords.length} puntos`);
        
        // 1. Dibujar la sombra (capa inferior)
        const shadowLine = L.polyline(leafletCoords, {
          color: 'rgba(0,0,0,0.5)',
          weight: 14,
          opacity: 0.4,
          lineCap: 'round',
          lineJoin: 'round',
          // Aumentar smoothFactor para simplificar aún más al renderizar
          smoothFactor: 2.0,
          className: 'route-shadow',
          // Reducir el impacto de las actualizaciones visuales
          interactive: false, // Solo la línea principal será interactiva
          renderer: new L.SVG({ padding: 0 })
        });
        
        // 2. Dibujar el borde blanco (capa intermedia)
        const routeOutline = L.polyline(leafletCoords, {
          color: 'white',
          weight: 10,
          opacity: 0.8,
          lineCap: 'round',
          lineJoin: 'round',
          smoothFactor: 2.0,
          className: 'route-outline',
          interactive: false,
          renderer: new L.SVG({ padding: 0 })
        });
        
        // 3. Dibujar la línea de la ruta (capa superior)
        const routeLine = L.polyline(leafletCoords, {
          color: route.color || '#3388ff',
          weight: 6,
          opacity: 1.0,
          lineCap: 'round',
          lineJoin: 'round',
          smoothFactor: 2.0,
          className: 'route-line',
          interactive: true,
          renderer: new L.SVG({ padding: 0 })
        });
        
        // Añadir a la capa de grupo para mejor rendimiento en lugar de directamente al mapa
        shadowLine.addTo(routeLayerGroup);
        routeOutline.addTo(routeLayerGroup);
        routeLine.addTo(routeLayerGroup);
        
        // Asegurar el orden correcto de las capas
        shadowLine.bringToBack();
        routeOutline.bringToFront();
        routeLine.bringToFront();
        
        // Crear y almacenar la instancia de RouteLayers
        const routeLayers = new RouteLayers(routeLine, routeOutline, shadowLine);
        layers[route.id] = routeLayers;
        
        // Agregar eventos solo a la línea principal (ahorro de memoria)
        routeLine.on('click', () => {
          onRouteClick(route.id);
        });
        
        // Optimizar el hover
        routeLine.on('mouseover', () => {
          if (!routeLine.options.className?.includes('hover')) {
            routeLine.setStyle({
              className: 'route-line hover'
            });
          }
        });
        
        routeLine.on('mouseout', () => {
          if (routeLine.options.className?.includes('hover') && 
              !routeLine.options.className?.includes('selected')) {
            routeLine.setStyle({
              className: 'route-line'
            });
          }
        });
        
      } catch (error) {
        console.error(`Error drawing route ${route.id}:`, error);
      }
    });
    
    // Procesar el siguiente lote de rutas en el próximo frame para evitar bloquear la UI
    if (endIndex < routes.length) {
      setTimeout(() => {
        processRoutesInBatches(routes, batchSize, endIndex);
      }, 0);
    }
  };
  
  // Iniciar el procesamiento por lotes
  processRoutesInBatches(routes);
  
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
    
    // Track la ruta que estaba seleccionada anteriormente
    const prevSelectedId = Object.keys(layers).find(id => {
      const routeLayers = layers[parseInt(id)];
      if (!routeLayers) return false;
      return routeLayers.route.options.className?.includes('selected');
    });
    
    // Si hay una ruta seleccionada anteriormente y no es la actual, resetear solo esa
    if (prevSelectedId && parseInt(prevSelectedId) !== selectedRouteId) {
      const prevRouteLayers = layers[parseInt(prevSelectedId)];
      if (prevRouteLayers) {
        const { route, outline, shadow } = prevRouteLayers;
        
        // Restablecer el estilo predeterminado solo para la ruta anteriormente seleccionada
        route.setStyle({
          weight: 6, 
          opacity: 1.0,
          className: 'route-line'
        });
        
        outline.setStyle({
          weight: 10,
          opacity: 0.8,
          className: 'route-outline'
        });
        
        shadow.setStyle({
          weight: 14,
          opacity: 0.4,
          className: 'route-shadow'
        });
        
        // Quitar la animación de pulsación
        if (typeof route.getElement === 'function') {
          const pathElement = route.getElement();
          if (pathElement) {
            pathElement.classList.remove('pulse-animation');
          }
        }
      }
    }
    
    // Si se selecciona una nueva ruta, aplicar el estilo destacado
    if (selectedRouteId !== null && layers[selectedRouteId]) {
      const selectedRouteLayers = layers[selectedRouteId];
      
      if (selectedRouteLayers) {
        const { route, outline, shadow } = selectedRouteLayers;
        
        console.log(`Aplicando estilo destacado a la ruta ${selectedRouteId}`);
        
        // Optimización: solo aplicar los cambios de estilo necesarios
        route.setStyle({
          weight: 10, 
          opacity: 1.0,
          className: 'route-line selected'
        });
        
        outline.setStyle({
          weight: 14,
          opacity: 0.9,
          className: 'route-outline selected'
        });
        
        shadow.setStyle({
          weight: 18,
          opacity: 0.5,
          className: 'route-shadow selected'
        });
        
        // Agregar efecto de pulsación a la ruta seleccionada con CSS
        if (typeof route.getElement === 'function') {
          const pathElement = route.getElement();
          if (pathElement) {
            pathElement.classList.add('pulse-animation');
          }
        }
        
        // Asegurar el orden correcto de las capas
        selectedRouteLayers.bringToFront();
        
        // Centrar el mapa en la ruta seleccionada con animación suave
        try {
          const bounds = route.getBounds();
          if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
            map.fitBounds(bounds, {
              padding: [80, 80],
              maxZoom: 15,
              animate: true,
              duration: 0.5
            });
          }
        } catch (boundError) {
          console.warn('No se pudo centrar en la ruta:', boundError);
        }
      }
    }
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
  
  // Usar un grupo de marcadores para mejor rendimiento
  const markerGroup = L.layerGroup().addTo(map);
  
  // Limitar el número de paradas si hay demasiadas (para mejor rendimiento)
  const maxStops = 50;
  const stopsToShow = stops.length > maxStops ? 
    // Siempre mostrar terminales si hay demasiadas paradas
    [...stops.filter(s => s.isTerminal === true), 
     ...stops.filter(s => s.isTerminal !== true).slice(0, maxStops - stops.filter(s => s.isTerminal === true).length)] :
    stops;
  
  stopsToShow.forEach((stop) => {
    // Asegurar que isTerminal es un booleano
    const isTerminal = stop.isTerminal === true;
    const icon = getBusStopIcon(isTerminal, color);
    const lat = parseFloat(stop.latitude);
    const lng = parseFloat(stop.longitude);
    
    if (isNaN(lat) || isNaN(lng)) {
      console.warn(`Coordenadas inválidas para parada ${stop.name}`);
      return;
    }
    
    // Crear el marcador y añadirlo al grupo de capas en lugar de directamente al mapa
    const marker = L.marker([lat, lng], { 
      icon,
      // Reducir interacciones para mejorar rendimiento
      interactive: true,
      bubblingMouseEvents: true
    }).addTo(markerGroup);
    
    // Crear el contenido del popup una vez y reutilizarlo
    const popupContent = `
      <div class="text-sm font-medium bus-stop-popup">
        <div class="font-bold">${stop.name}</div>
        <div class="text-xs text-gray-600">Ruta ID: ${routeId}</div>
        ${stop.terminalType ? `<div class="text-xs">${stop.terminalType === 'first' ? 'Terminal de origen' : 'Terminal de destino'}</div>` : ''}
      </div>
    `;
    
    // Configurar popup con opciones optimizadas
    marker.bindPopup(popupContent, {
      closeButton: false,
      offset: L.point(0, -8),
      className: 'bus-stop-popup',
      maxWidth: 200,
      minWidth: 150,
      autoPan: false // Evitar costosos pans automáticos
    });
    
    markers.push(marker);
  });
  
  return markers;
}
