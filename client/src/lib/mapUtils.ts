import L from 'leaflet';
import { BusRoute, GeoJSONFeature } from '@shared/schema';
import { XALAPA_CENTER, XALAPA_BOUNDS, MIN_ZOOM, MAX_ZOOM } from './constants';

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
  // Crear el mapa con configuración exacta para Xalapa
  const map = L.map(container, {
    zoomControl: false,
    attributionControl: true,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    // Usamos maxBounds más grandes para la carga de tiles (evita áreas blancas)
    maxBounds: L.latLngBounds(XALAPA_BOUNDS),
    maxBoundsViscosity: 1.0, // Hace que el mapa "rebote" cuando se intenta alejar de los límites
    zoomSnap: 0.5,  // Permite niveles de zoom fraccionarios como 9.5
    wheelPxPerZoomLevel: 120,  // Control más preciso del zoom con la rueda del ratón
    bounceAtZoomLimits: true,  // Rebote al alcanzar los límites de zoom
    fadeAnimation: true,       // Animación de fundido para tiles
    preferCanvas: true         // Usar canvas para mejor rendimiento
  }).setView(center, zoom);
  
  // Usar Mapbox como proveedor de mapas base (exactamente como Mapaton)
  const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';
  
  if (mapboxToken) {
    // Si tenemos un token de Mapbox, usamos sus mapas de alta calidad
    L.tileLayer('https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles/{z}/{x}/{y}?access_token=' + mapboxToken, {
      attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: MAX_ZOOM,
      minZoom: MIN_ZOOM - 1,  // Cargamos un nivel más para evitar áreas blancas
      tileSize: 512,
      zoomOffset: -1,
      noWrap: true,  // Evitar repetición de tiles
      updateWhenIdle: false,  // Mantener actualizado incluso durante el desplazamiento
      updateWhenZooming: true,  // Actualizar durante el zoom
      keepBuffer: 8,  // Mantener más tiles en buffer (por defecto es 2)
      className: 'map-tile-layer'  // Clase CSS para dar estilo a los tiles
    }).addTo(map);
  } else {
    // Fallback a OpenStreetMap si no hay token de Mapbox
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: MAX_ZOOM,
      minZoom: MIN_ZOOM - 1,  // Cargamos un nivel más para evitar áreas blancas
      noWrap: true,  // Evitar repetición de tiles
      updateWhenIdle: false,  // Mantener actualizado incluso durante el desplazamiento
      updateWhenZooming: true,  // Actualizar durante el zoom
      keepBuffer: 8,  // Mantener más tiles en buffer (por defecto es 2)
      className: 'map-tile-layer'  // Clase CSS para dar estilo a los tiles
    }).addTo(map);
  }
  
  // No necesitamos evento moveend ya que maxBoundsViscosity:1.0 maneja este comportamiento
  // El efecto será exactamente como en orizo.fr: te rebota hacia atrás si intentas salir del área
  
  return map;
}

// Get bus stop icon - Estilo orizo.fr actualizado según nueva imagen de referencia
export function getBusStopIcon(isTerminal: boolean | null, color: string = '#ffffff'): L.DivIcon {
  // En caso de que isTerminal sea null, tratarlo como false
  const isActuallyTerminal = isTerminal === true;
  
  // Tamaños según la imagen de referencia (círculos blancos uniformes)
  const size = isActuallyTerminal ? 16 : 12;
  
  // Color de relleno y borde para el estilo de la imagen
  // Todas las paradas son círculos blancos con borde amarillo
  const fillColor = '#FFFFFF';
  const borderColor = '#FFDD00'; // Amarillo como la ruta
  const borderWidth = 2;
  
  return L.divIcon({
    className: 'bus-stop-icon orizo-style',
    html: `
      <div 
        class="rounded-full shadow-xl" 
        style="
          width: ${size}px; 
          height: ${size}px; 
          background-color: ${fillColor};
          border: ${borderWidth}px solid ${borderColor};
          box-shadow: 0 0 4px rgba(0,0,0,0.3);
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
        
        // 1. Dibujar la sombra (capa inferior - estilo orizo.fr)
        const shadowLine = L.polyline(leafletCoords, {
          color: 'rgba(0,0,0,0.3)',
          weight: 14,
          opacity: 0.3,
          lineCap: 'butt',
          lineJoin: 'round',
          // Aumentar smoothFactor para simplificar aún más al renderizar
          smoothFactor: 1.0,
          className: 'route-shadow orizo-style',
          // Reducir el impacto de las actualizaciones visuales
          interactive: false, // Solo la línea principal será interactiva
          renderer: new L.SVG({ padding: 0 })
        });
        
        // 2. Dibujar el borde blanco (capa intermedia)
        const routeOutline = L.polyline(leafletCoords, {
          color: 'white',
          weight: 10,
          opacity: 0.9,
          lineCap: 'butt',
          lineJoin: 'round',
          smoothFactor: 1.0,
          className: 'route-outline orizo-style',
          interactive: false,
          renderer: new L.SVG({ padding: 0 })
        });
        
        // 3. Dibujar la línea de la ruta estilo orizo.fr
        // El color principal de las rutas es amarillo brillante como en la imagen de referencia
        const routeLine = L.polyline(leafletCoords, {
          color: '#FFDD00', // Amarillo brillante como en la imagen compartida
          weight: 8,
          opacity: 1.0,
          lineCap: 'butt',
          lineJoin: 'round',
          smoothFactor: 1.0,
          className: 'route-line orizo-style',
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

// Highlight selected route and hide others (like mapaton.org)
export function highlightRoute(
  map: L.Map, 
  layers: Record<number, RouteLayers>, 
  selectedRouteId: number | null
): void {
  try {
    console.log(`Resaltando ruta ${selectedRouteId}, hay ${Object.keys(layers).length} capas disponibles`);
    
    // Si no hay ninguna ruta seleccionada, mostrar todas las rutas
    if (selectedRouteId === null) {
      // Mostrar todas las rutas con estilo normal
      Object.keys(layers).forEach(id => {
        const routeId = parseInt(id);
        const routeLayers = layers[routeId];
        if (!routeLayers) return;
        
        // Si la capa está en el mapa, aplicar estilo normal
        if (map.hasLayer(routeLayers.route)) {
          routeLayers.route.setStyle({
            weight: 6, 
            opacity: 1.0,
            className: 'route-line'
          });
          
          routeLayers.outline.setStyle({
            weight: 10,
            opacity: 0.8,
            className: 'route-outline'
          });
          
          routeLayers.shadow.setStyle({
            weight: 14,
            opacity: 0.4,
            className: 'route-shadow'
          });
        } 
        // Si no está en el mapa, agregarla
        else {
          routeLayers.shadow.addTo(map);
          routeLayers.outline.addTo(map);
          routeLayers.route.addTo(map);
          
          // Asegurar el orden correcto
          routeLayers.shadow.bringToBack();
          routeLayers.outline.bringToFront();
          routeLayers.route.bringToFront();
        }
        
        // Quitar animación de pulsación
        const pathElement = routeLayers.route.getElement();
        if (pathElement) {
          pathElement.classList.remove('pulse-animation');
        }
      });
      
      return;
    }
    
    // Si hay una ruta seleccionada, mostrar solo esa y ocultar las demás
    Object.keys(layers).forEach(id => {
      const routeId = parseInt(id);
      const routeLayers = layers[routeId];
      if (!routeLayers) return;
      
      // Si es la ruta seleccionada
      if (routeId === selectedRouteId) {
        // Asegurarse de que la ruta está en el mapa
        if (!map.hasLayer(routeLayers.route)) {
          routeLayers.shadow.addTo(map);
          routeLayers.outline.addTo(map);
          routeLayers.route.addTo(map);
        }
        
        // Aplicar estilo destacado
        console.log(`Aplicando estilo destacado a la ruta ${selectedRouteId}`);
        
        // Estilo actualizado para ruta seleccionada (línea gris oscuro, según imagen)
        routeLayers.route.setStyle({
          weight: 10, 
          opacity: 1.0,
          color: '#404040', // Gris oscuro para ruta seleccionada (como en la imagen)
          className: 'route-line selected orizo-style'
        });
        
        routeLayers.outline.setStyle({
          weight: 14,
          opacity: 0.9,
          className: 'route-outline selected orizo-style'
        });
        
        routeLayers.shadow.setStyle({
          weight: 16,
          opacity: 0.4,
          className: 'route-shadow selected orizo-style'
        });
        
        // Agregar animación de pulsación
        const pathElement = routeLayers.route.getElement();
        if (pathElement) {
          pathElement.classList.add('pulse-animation');
        }
        
        // Asegurar que está en frente
        routeLayers.bringToFront();
        
        // Centrar el mapa en la ruta seleccionada
        try {
          const bounds = routeLayers.route.getBounds();
          if (bounds && bounds.isValid()) {
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
      // Si no es la ruta seleccionada, eliminarla del mapa
      else {
        if (map.hasLayer(routeLayers.route)) {
          map.removeLayer(routeLayers.route);
          map.removeLayer(routeLayers.outline);
          map.removeLayer(routeLayers.shadow);
        }
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
  
  // Usar un grupo de marcadores para mejor rendimiento
  const markerGroup = L.layerGroup().addTo(map);
  
  // Mostrar todas las paradas sin limitación
  const stopsToShow = stops;
  
  stopsToShow.forEach((stop) => {
    // Asegurar que isTerminal es un booleano
    const isTerminal = stop.isTerminal === true;
    
    // En orizo.fr, las paradas terminales tienen un estilo diferente
    // y las paradas regulares tienen un borde del color de la ruta
    // Aseguramos usar el color correcto para el estilo orizo.fr
    const stopColor = isTerminal ? color : '#4caf50'; // Verde de orizo.fr para paradas regulares
    
    const icon = getBusStopIcon(isTerminal, stopColor);
    const lat = parseFloat(stop.latitude);
    const lng = parseFloat(stop.longitude);
    
    if (isNaN(lat) || isNaN(lng)) {
      console.warn(`Coordenadas inválidas para parada ${stop.name}`);
      return;
    }
    
    // Crear el marcador con estilo orizo.fr
    const marker = L.marker([lat, lng], { 
      icon,
      // Hacer las paradas interactivas como en orizo.fr
      interactive: true,
      bubblingMouseEvents: true
    }).addTo(markerGroup);
    
    // Añadir clase CSS si está disponible el elemento
    const element = marker.getElement();
    if (element) {
      element.classList.add(isTerminal ? 'terminal-stop' : 'regular-stop');
      element.classList.add('orizo-style');
    }
    
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

// Generar icono para el punto de origen (verde) como en orizo.fr
export function getOriginIcon(): L.DivIcon {
  return L.divIcon({
    className: 'origin-point-icon',
    html: `
      <div style="position: relative;">
        <div
          class="rounded-full shadow-xl" 
          style="
            width: 22px; 
            height: 22px; 
            background-color: #4CAF50;
            border: 2px solid white;
            box-shadow: 0 0 4px rgba(0,0,0,0.5);
            position: absolute;
            top: -22px;
            left: -11px;
          "
        ></div>
        <!-- Pequeña flecha inferior para señalar la ubicación exacta -->
        <div 
          style="
            width: 0; 
            height: 0; 
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 8px solid #4CAF50;
            position: absolute;
            top: -2px;
            left: -6px;
          "
        ></div>
      </div>
    `,
    iconSize: [22, 30],
    iconAnchor: [11, 30]
  });
}

// Generar icono para el punto de destino (naranja) como en orizo.fr
export function getDestinationIcon(): L.DivIcon {
  return L.divIcon({
    className: 'destination-point-icon',
    html: `
      <div style="position: relative;">
        <div
          class="rounded-full shadow-xl" 
          style="
            width: 22px; 
            height: 22px; 
            background-color: #FF9800;
            border: 2px solid white;
            box-shadow: 0 0 4px rgba(0,0,0,0.5);
            position: absolute;
            top: -22px;
            left: -11px;
          "
        ></div>
        <!-- Pequeña flecha inferior para señalar la ubicación exacta -->
        <div 
          style="
            width: 0; 
            height: 0; 
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 8px solid #FF9800;
            position: absolute;
            top: -2px;
            left: -6px;
          "
        ></div>
      </div>
    `,
    iconSize: [22, 30],
    iconAnchor: [11, 30]
  });
}
