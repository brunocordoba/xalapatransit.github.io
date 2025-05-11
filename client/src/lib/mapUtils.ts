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
  onRouteClick: (routeId: number) => void,
  selectedRouteId: number | null = null
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
        
        // Simplificación avanzada para mejorar rendimiento
        // Aplicamos una simplificación más agresiva a medida que hay más rutas y puntos
        let simplifiedCoords = coordinates;
        
        if (coordinates.length > 50) {
          // Nivel de simplificación basado en la cantidad de rutas y puntos
          const maxPoints = routes.length > 100 ? 30 : (routes.length > 50 ? 50 : 80);
          
          if (coordinates.length > maxPoints) {
            // Simplificación adaptativa - más agresiva cuando hay más rutas
            const ratio = maxPoints / coordinates.length;
            const step = Math.max(1, Math.floor(1 / ratio));
            
            // Asegurarse de mantener puntos críticos (inicio, fin, y algunos intermedios)
            simplifiedCoords = [];
            
            // Siempre incluir el punto inicial
            simplifiedCoords.push(coordinates[0]);
            
            // Muestrear puntos intermedios
            for (let i = 1; i < coordinates.length - 1; i += step) {
              simplifiedCoords.push(coordinates[i]);
            }
            
            // Siempre incluir el punto final
            if (coordinates.length > 1 && simplifiedCoords[simplifiedCoords.length - 1] !== coordinates[coordinates.length - 1]) {
              simplifiedCoords.push(coordinates[coordinates.length - 1]);
            }
            
            console.log(`Simplificado ruta ${route.id}: ${coordinates.length} → ${simplifiedCoords.length} puntos`);
          }
        }
        
        // Convertir coordenadas a formato Leaflet [lat, lng]
        const leafletCoords = simplifiedCoords.map(coord => {
          if (typeof coord[0] === 'number' && typeof coord[1] === 'number') {
            return [coord[1], coord[0]] as [number, number];
          }
          return coord;
        });
        
        console.log(`Dibujando ruta ${route.id} con ${leafletCoords.length} puntos`);
        
        // Optimización basada en la carga total - reducir calidad para mejorar rendimiento
        const isHighLoad = routes.length > 100;
        const useSimplifiedRendering = isHighLoad && !route.popular && selectedRouteId !== null && route.id !== selectedRouteId;
        
        // Renderer compartido para optimizar memoria
        const sharedRenderer = new L.SVG({ padding: 0 });
        
        // Ajustar la calidad según la carga
        const smoothFactor = useSimplifiedRendering ? 3.0 : 2.0;
        
        // 1. Dibujar la sombra (capa inferior) - sólo para rutas importantes en alta carga
        const shadowLine = useSimplifiedRendering ? 
          // Versión simplificada para alta carga (sin sombra)
          L.polyline([], { opacity: 0 }) :
          // Versión normal con sombra
          L.polyline(leafletCoords, {
            color: 'rgba(0,0,0,0.5)',
            weight: 14,
            opacity: 0.4,
            lineCap: 'round',
            lineJoin: 'round',
            smoothFactor: smoothFactor,
            className: 'route-shadow',
            interactive: false,
            renderer: sharedRenderer
          });
        
        // 2. Dibujar el borde blanco (capa intermedia) - simplificado para alta carga
        const routeOutline = useSimplifiedRendering ?
          // Versión simplificada para alta carga (borde más delgado)
          L.polyline(leafletCoords, {
            color: 'white',
            weight: 8,
            opacity: 0.6,
            lineCap: 'round',
            lineJoin: 'round',
            smoothFactor: smoothFactor,
            className: 'route-outline simplified',
            interactive: false,
            renderer: sharedRenderer
          }) :
          // Versión normal
          L.polyline(leafletCoords, {
            color: 'white',
            weight: 10,
            opacity: 0.8,
            lineCap: 'round',
            lineJoin: 'round',
            smoothFactor: smoothFactor,
            className: 'route-outline',
            interactive: false,
            renderer: sharedRenderer
          });
        
        // 3. Dibujar la línea de la ruta (capa superior)
        const routeLine = L.polyline(leafletCoords, {
          color: route.color || '#3388ff',
          weight: useSimplifiedRendering ? 4 : 6,
          opacity: useSimplifiedRendering ? 0.8 : 1.0,
          lineCap: 'round',
          lineJoin: 'round',
          smoothFactor: smoothFactor,
          className: `route-line${useSimplifiedRendering ? ' simplified' : ''}${isHighLoad ? ' high-load' : ''}`,
          interactive: true, // Siempre interactiva para poder seleccionar
          renderer: sharedRenderer
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
  selectedRouteId: number | null,
  showAllRoutes: boolean = true
): void {
  try {
    console.log(`Resaltando ruta ${selectedRouteId}, hay ${Object.keys(layers).length} capas disponibles, mostrar todas: ${showAllRoutes}`);
    
    // Procesar todas las rutas
    Object.keys(layers).forEach(id => {
      const routeId = parseInt(id);
      const routeLayers = layers[routeId];
      const isSelected = routeId === selectedRouteId;
      const shouldBeVisible = isSelected || showAllRoutes;
      
      if (!routeLayers) return;
      
      // Configurar visibilidad y estilos
      const baseOpacity = shouldBeVisible ? 1.0 : 0.0;
      const outlineOpacity = shouldBeVisible ? 0.8 : 0.0;  
      const shadowOpacity = shouldBeVisible ? 0.4 : 0.0;
      
      // Aplicar estilos según si es la ruta seleccionada o no
      routeLayers.route.setStyle({
        weight: isSelected ? 8 : 6,
        opacity: baseOpacity,
        className: isSelected ? 'route-line selected' : 'route-line'
      });
      
      routeLayers.outline.setStyle({
        weight: isSelected ? 12 : 10,
        opacity: outlineOpacity,
        className: isSelected ? 'route-outline selected' : 'route-outline'
      });
      
      routeLayers.shadow.setStyle({
        weight: isSelected ? 16 : 14,
        opacity: shadowOpacity,
        className: isSelected ? 'route-shadow selected' : 'route-shadow'
      });
      
      // Manejar animaciones
      if (typeof routeLayers.route.getElement === 'function') {
        const pathElement = routeLayers.route.getElement();
        if (pathElement) {
          if (isSelected) {
            pathElement.classList.add('pulse-animation');
          } else {
            pathElement.classList.remove('pulse-animation');
          }
        }
      }
      
      // Si es la ruta seleccionada, asegurarse de que esté en primer plano
      if (isSelected) {
        routeLayers.bringToFront();
        
        // Centrar el mapa en la ruta seleccionada
        try {
          const bounds = routeLayers.route.getBounds();
          if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
            map.fitBounds(bounds, {
              padding: [80, 80],
              maxZoom: 15,
              animate: true,
              duration: 0.5
            });
          }
        } catch (e) {
          console.warn('No se pudo centrar en la ruta:', e);
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
  
  // Limpiar paradas existentes para evitar duplicados
  map.eachLayer((layer) => {
    if (layer instanceof L.Marker && (layer as any)._routeId === routeId) {
      map.removeLayer(layer);
    }
  });
  
  // Si no hay paradas, mostrar mensaje en la consola pero no fallar
  if (!stops || !Array.isArray(stops) || stops.length === 0) {
    console.log(`No hay paradas disponibles para la ruta ${routeId}`);
    return markers;
  }
  
  console.log(`Añadiendo ${stops.length} paradas para la ruta ${routeId}`);
  
  // Usar un grupo de marcadores para mejor rendimiento
  const markerGroup = L.layerGroup().addTo(map);
  
  // Limitar el número de paradas si hay demasiadas (para mejor rendimiento)
  const maxStops = 50;
  
  // Asegurarnos de que las terminales siempre se muestren
  let terminalStops = stops.filter(s => s.isTerminal === true);
  let regularStops = stops.filter(s => s.isTerminal !== true);
  
  // Limitar paradas regulares si hay demasiadas
  if (regularStops.length > maxStops - terminalStops.length) {
    regularStops = regularStops.slice(0, maxStops - terminalStops.length);
  }
  
  // Combinar para obtener las paradas a mostrar
  const stopsToShow = [...terminalStops, ...regularStops];
  
  // Usar procesamiento por lotes para no bloquear UI
  const batchSize = 10;
  
  const processBatch = (startIndex: number) => {
    const endIndex = Math.min(startIndex + batchSize, stopsToShow.length);
    const batch = stopsToShow.slice(startIndex, endIndex);
    
    batch.forEach((stop) => {
      try {
        // Asegurar que isTerminal es un booleano
        const isTerminal = stop.isTerminal === true;
        const icon = getBusStopIcon(isTerminal, color);
        
        // Convertir coordenadas a números
        const lat = parseFloat(stop.latitude);
        const lng = parseFloat(stop.longitude);
        
        if (isNaN(lat) || isNaN(lng)) {
          console.warn(`Coordenadas inválidas para parada ${stop.name}`);
          return;
        }
        
        // Crear el marcador con metadatos
        const marker = L.marker([lat, lng], { 
          icon,
          // Optimizaciones de rendimiento
          interactive: true,
          bubblingMouseEvents: true
        }).addTo(markerGroup);
        
        // Almacenar ID de ruta como propiedad personalizada
        (marker as any)._routeId = routeId;
        
        // Crear popup ligero
        const popupContent = `
          <div class="bus-stop-popup p-2">
            <div class="font-bold text-sm">${stop.name || 'Parada sin nombre'}</div>
            <div class="text-xs text-gray-600">Ruta: ${routeId}</div>
            ${isTerminal ? `<div class="text-xs font-medium mt-1">Terminal</div>` : ''}
          </div>
        `;
        
        // Configurar popup con opciones optimizadas
        marker.bindPopup(popupContent, {
          closeButton: false,
          offset: L.point(0, -8),
          className: 'bus-stop-popup',
          maxWidth: 180,
          minWidth: 120,
          autoPan: false // Evitar costosos pans automáticos
        });
        
        markers.push(marker);
      } catch (error) {
        console.error(`Error al añadir parada: ${error}`);
      }
    });
    
    // Si hay más paradas, programar el siguiente lote
    if (endIndex < stopsToShow.length) {
      setTimeout(() => processBatch(endIndex), 10);
    }
  };
  
  // Iniciar el procesamiento por lotes
  processBatch(0);
  
  return markers;
}
