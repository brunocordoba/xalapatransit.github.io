import L from 'leaflet';
import { BusRoute } from '@shared/schema';

// Clase para gestionar las capas de las rutas
export class RouteLayers {
  route: L.Polyline;
  outline: L.Polyline;
  shadow: L.Polyline;

  constructor(
    route: L.Polyline,
    outline: L.Polyline,
    shadow: L.Polyline
  ) {
    this.route = route;
    this.outline = outline;
    this.shadow = shadow;
  }

  // Traer al frente
  bringToFront() {
    this.shadow.bringToFront();
    this.outline.bringToFront();
    this.route.bringToFront();
  }

  // Eliminar todas las capas
  remove() {
    this.shadow.remove();
    this.outline.remove();
    this.route.remove();
  }
}

// Inicializar el mapa
export function initializeMap(container: HTMLElement, center: [number, number], zoom: number): L.Map {
  // Crear la instancia del mapa
  const map = L.map(container, {
    center,
    zoom,
    zoomControl: false,
    attributionControl: true,
    preferCanvas: false, // SVG para mejor calidad
    // Optimizaciones de rendimiento
    wheelDebounceTime: 100,
    doubleClickZoom: true,
    dragging: true,
    scrollWheelZoom: true
  });

  // Tile layer base
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    // Optimizaciones para el renderizado de tiles
    updateWhenZooming: false,
    updateWhenIdle: true,
    keepBuffer: 2
  }).addTo(map);

  // Aplicar optimizaciones CSS
  container.classList.add('optimized-map');

  return map;
}

// Icono personalizado para paradas de autobús
export function getBusStopIcon(isTerminal: boolean | null, color: string = '#ffffff'): L.DivIcon {
  const baseSize = isTerminal ? 12 : 8;
  const borderSize = isTerminal ? 2 : 1;
  const innerSize = baseSize - (borderSize * 2);
  
  // Optimizar creación de HTML usando template literals
  return L.divIcon({
    className: `bus-stop-icon${isTerminal ? ' terminal' : ''}`,
    html: `<div style="
      width: ${baseSize}px;
      height: ${baseSize}px;
      border-radius: 50%;
      background-color: white;
      border: ${borderSize}px solid black;
      display: flex;
      justify-content: center;
      align-items: center;
    ">
      <div style="
        width: ${innerSize}px;
        height: ${innerSize}px;
        border-radius: 50%;
        background-color: ${color};
      "></div>
    </div>`,
    iconSize: [baseSize, baseSize],
    iconAnchor: [baseSize/2, baseSize/2]
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
    const currentBatch = routes.slice(startIndex, endIndex);
    
    currentBatch.forEach(route => {
      // Extraer coordenadas de GeoJSON
      let coordinates: [number, number][] = [];
      try {
        if (typeof route.geoJSON === 'string') {
          const geoJSON = JSON.parse(route.geoJSON);
          if (geoJSON && geoJSON.geometry && geoJSON.geometry.coordinates) {
            coordinates = geoJSON.geometry.coordinates;
          }
        } else if (route.geoJSON && typeof route.geoJSON === 'object') {
          // @ts-ignore
          if (route.geoJSON.geometry && route.geoJSON.geometry.coordinates) {
            // @ts-ignore
            coordinates = route.geoJSON.geometry.coordinates;
          }
        }
      } catch (error) {
        console.error(`Error al procesar GeoJSON para ruta ${route.id}:`, error);
      }
      
      if (coordinates.length < 2) {
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
          return [coord[1], coord[0]]; // Invertir ya que GeoJSON usa [lng, lat]
        }
        return [0, 0]; // Valor por defecto en caso de error
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
      
      // Añadir metadatos y evento click
      routeLine.on('click', () => {
        onRouteClick(route.id);
      });
      
      // Añadir tooltip con el nombre de la ruta
      routeLine.bindTooltip(route.name, {
        permanent: false,
        direction: 'auto',
        className: 'route-tooltip'
      });
      
      // Guardar referencia a las capas
      layers[route.id] = new RouteLayers(routeLine, routeOutline, shadowLine);
    });
    
    // Procesar el siguiente lote después de un pequeño retraso
    window.setTimeout(() => {
      processRoutesInBatches(routes, batchSize, endIndex);
    }, 10);
  };
  
  // Iniciar el procesamiento por lotes
  processRoutesInBatches(routes);
  
  return { map, layers };
}

// Highlight selected route con optimizaciones de rendimiento
// Versión mejorada de la función highlightRoute que REALMENTE oculta todas las rutas excepto la seleccionada
export function highlightRoute(
  map: L.Map, 
  layers: Record<number, RouteLayers>, 
  selectedRouteId: number | null,
  showAllRoutes: boolean = true
): void {
  try {
    console.log(`Resaltando ruta ${selectedRouteId}, hay ${Object.keys(layers).length} capas disponibles, mostrar todas: ${showAllRoutes}`);
    
    // Detección de alta carga
    const isHighLoad = Object.keys(layers).length > 100;
    
    // Aplicar clase de alta carga al contenedor del mapa para optimizaciones CSS
    if (isHighLoad && map.getContainer()) {
      map.getContainer().classList.toggle('high-load-mode', true);
    } else if (map.getContainer()) {
      map.getContainer().classList.remove('high-load-mode');
    }
    
    // Procesar todas las rutas en el siguiente frame para mejor rendimiento UI
    requestAnimationFrame(() => {
      // Procesar todas las rutas
      Object.keys(layers).forEach(id => {
        const routeId = parseInt(id);
        const routeLayers = layers[routeId];
        const isSelected = routeId === selectedRouteId;
        // MEJORA: Una ruta es visible solo si:
        // 1. Es la ruta seleccionada, O
        // 2. Se muestra todas las rutas (showAllRoutes = true)
        const shouldBeVisible = isSelected || showAllRoutes;
        
        if (!routeLayers) return;
        
        // CAMBIO CLAVE: Si la ruta no debe ser visible, la ocultamos completamente
        if (!shouldBeVisible) {
          routeLayers.route.setStyle({ opacity: 0 });
          routeLayers.outline.setStyle({ opacity: 0 });
          routeLayers.shadow.setStyle({ opacity: 0 });
          return; // No seguir procesando esta ruta
        }
        
        // Si llegamos aquí, la ruta debe ser visible
        const baseOpacity = isHighLoad && !isSelected ? 0.8 : 1.0;
        const outlineOpacity = isHighLoad && !isSelected ? 0.6 : 0.8;  
        const shadowOpacity = isHighLoad && !isSelected ? 0.2 : 0.4;
        
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
  
  // Procesar paradas por lotes para no bloquear el hilo principal
  const batchSize = 10;
  
  const processBatch = (startIndex: number) => {
    const endIndex = Math.min(startIndex + batchSize, stopsToShow.length);
    const currentBatch = stopsToShow.slice(startIndex, endIndex);
    
    currentBatch.forEach(stop => {
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