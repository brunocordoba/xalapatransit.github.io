import { useEffect, useRef, useState } from 'react';
import { Plus, Minus, MapPin, Navigation, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BusRoute, BusStop } from '@shared/schema';
import { initializeMap, addBusStops } from '@/lib/mapUtils';
import { XALAPA_CENTER, DEFAULT_ZOOM } from '@/lib/constants';
import L from 'leaflet';

type RouteMapViewProps = {
  routes: BusRoute[];
  selectedRoutes?: number[];
  walkingPoints?: {
    startPoint: [number, number];
    endPoint: [number, number];
  };
  showStops?: boolean;
};

// Función auxiliar para dibujar una sola ruta
function drawSingleRoute(
  map: L.Map,
  route: BusRoute,
  isSelected: boolean,
  onRouteClick?: (routeId: number) => void
): {routeLine: L.Polyline, routeOutline: L.Polyline, shadowLine: L.Polyline} {
  try {
    const geoJSON = route.geoJSON as any;
    if (!geoJSON) {
      console.warn(`La ruta ${route.id} no tiene datos GeoJSON`);
      return {} as any;
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
      return {} as any;
    }
    
    // Validar que hay coordenadas y que son válidas
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
      console.warn(`La ruta ${route.id} no tiene suficientes coordenadas válidas`);
      return {} as any;
    }
    
    // Simplificar la geometría para mejor rendimiento
    let simplifiedCoords = coordinates;
    if (coordinates.length > 100) {
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
    
    // Estilos según si la ruta está seleccionada o no
    const shadowWeight = isSelected ? 18 : 14;
    const outlineWeight = isSelected ? 14 : 10;
    const routeWeight = isSelected ? 10 : 6;
    const shadowOpacity = isSelected ? 0.5 : 0.4;
    const outlineOpacity = isSelected ? 0.9 : 0.8;
    const routeOpacity = 1.0;
    const routeClassName = isSelected ? 'route-line selected' : 'route-line';
    
    // 1. Dibujar la sombra (capa inferior)
    const shadowLine = L.polyline(leafletCoords, {
      color: 'rgba(0,0,0,0.5)',
      weight: shadowWeight,
      opacity: shadowOpacity,
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: 2.0,
      className: 'route-shadow',
      interactive: false,
      renderer: new L.SVG({ padding: 0 })
    });
    
    // 2. Dibujar el borde blanco (capa intermedia)
    const routeOutline = L.polyline(leafletCoords, {
      color: 'white',
      weight: outlineWeight,
      opacity: outlineOpacity,
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
      weight: routeWeight,
      opacity: routeOpacity,
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: 2.0,
      className: routeClassName,
      interactive: true,
      renderer: new L.SVG({ padding: 0 })
    });
    
    // Agregar eventos solo a la línea principal si se proporciona una función de click
    if (onRouteClick) {
      routeLine.on('click', () => {
        onRouteClick(route.id);
      });
    }
    
    return { routeLine, routeOutline, shadowLine };
  } catch (error) {
    console.error(`Error al dibujar la ruta ${route.id}:`, error);
    return {} as any;
  }
}

// Función para dibujar puntos de caminata (inicio y fin)
function drawWalkingPoints(
  map: L.Map, 
  startPoint: [number, number], 
  endPoint: [number, number]
) {
  // Icono para el punto de inicio (verde)
  const startIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: #4caf50; width: 15px; height: 15px; 
           border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [15, 15],
    iconAnchor: [7, 7]
  });
  
  // Icono para el punto final (rojo)
  const endIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: #f44336; width: 15px; height: 15px; 
           border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [15, 15],
    iconAnchor: [7, 7]
  });
  
  // Crear marcadores
  const startMarker = L.marker(startPoint, { icon: startIcon }).addTo(map);
  const endMarker = L.marker(endPoint, { icon: endIcon }).addTo(map);
  
  // Línea de caminata punteada
  const walkingPath = L.polyline([startPoint, endPoint], {
    color: '#4caf50',
    weight: 3,
    opacity: 0.7,
    dashArray: '5, 7',
  }).addTo(map);
  
  return { startMarker, endMarker, walkingPath };
}

export default function RouteMapView({ 
  routes, 
  selectedRoutes = [],
  walkingPoints,
  showStops = true
}: RouteMapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const routeLayersRef = useRef<Map<number, {routeLine: L.Polyline, routeOutline: L.Polyline, shadowLine: L.Polyline}>>(new Map());
  const stopMarkersRef = useRef<L.Marker[]>([]);
  const walkingMarkersRef = useRef<{startMarker?: L.Marker, endMarker?: L.Marker, walkingPath?: L.Polyline}>({});
  
  const [mapReady, setMapReady] = useState(false);
  
  // Initialize map
  useEffect(() => {
    if (mapContainerRef.current && !mapInstanceRef.current) {
      const map = initializeMap(mapContainerRef.current, XALAPA_CENTER, DEFAULT_ZOOM);
      mapInstanceRef.current = map;
      setMapReady(true);
    }
    
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);
  
  // Efecto para manejar la visualización de rutas seleccionadas
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    
    const map = mapInstanceRef.current;
    
    // Limpiar todas las rutas existentes del mapa
    routeLayersRef.current.forEach((layers, routeId) => {
      if (map.hasLayer(layers.routeLine)) {
        map.removeLayer(layers.routeLine);
        map.removeLayer(layers.routeOutline);
        map.removeLayer(layers.shadowLine);
      }
    });
    
    // Resetear las capas almacenadas
    routeLayersRef.current.clear();
    
    // Si no hay rutas seleccionadas, terminamos aquí
    if (selectedRoutes.length === 0) {
      return;
    }
    
    // Dibujar las rutas seleccionadas
    const routesToShow = routes.filter(r => selectedRoutes.includes(r.id));
    
    if (routesToShow.length > 0) {
      // Bounds para ajustar el mapa
      const bounds = L.latLngBounds([]);
      
      routesToShow.forEach(route => {
        const layers = drawSingleRoute(map, route, true);
        
        if (Object.keys(layers).length === 0) return;
        
        // Añadir las capas al mapa
        layers.shadowLine.addTo(map);
        layers.routeOutline.addTo(map);
        layers.routeLine.addTo(map);
        
        // Asegurar el orden correcto de las capas
        layers.shadowLine.bringToBack();
        layers.routeOutline.bringToFront();
        layers.routeLine.bringToFront();
        
        // Guardar referencia a las capas
        routeLayersRef.current.set(route.id, layers);
        
        // Extender los bounds para incluir esta ruta
        try {
          const routeBounds = layers.routeLine.getBounds();
          if (routeBounds && routeBounds.isValid()) {
            bounds.extend(routeBounds);
          }
        } catch (error) {
          console.error("Error al extender bounds:", error);
        }
      });
      
      // Ajustar el mapa a los bounds de todas las rutas
      if (bounds.isValid()) {
        map.fitBounds(bounds, {
          padding: [50, 50],
          maxZoom: 15,
          animate: true
        });
      }
    }
  }, [mapReady, routes, selectedRoutes]);
  
  // Efecto para dibujar puntos de caminata
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !walkingPoints) return;
    
    const map = mapInstanceRef.current;
    
    // Limpiar marcadores anteriores
    if (walkingMarkersRef.current.startMarker) {
      map.removeLayer(walkingMarkersRef.current.startMarker);
    }
    if (walkingMarkersRef.current.endMarker) {
      map.removeLayer(walkingMarkersRef.current.endMarker);
    }
    if (walkingMarkersRef.current.walkingPath) {
      map.removeLayer(walkingMarkersRef.current.walkingPath);
    }
    
    // Dibujar nuevos puntos
    const { startPoint, endPoint } = walkingPoints;
    const markers = drawWalkingPoints(map, startPoint, endPoint);
    walkingMarkersRef.current = markers;
    
  }, [mapReady, walkingPoints]);
  
  // Controles del mapa
  const handleZoomIn = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.zoomIn();
    }
  };
  
  const handleZoomOut = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.zoomOut();
    }
  };
  
  const handleLocateMe = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.locate({
        setView: true,
        maxZoom: 16,
      });
    }
  };
  
  return (
    <div className="flex-grow relative">
      <div ref={mapContainerRef} className="h-full w-full" />
      
      {/* Map Controls */}
      <div className="absolute top-4 right-4 flex flex-col space-y-2">
        <Button
          variant="outline"
          size="icon"
          className="bg-white p-2 rounded-full shadow-md hover:bg-gray-100"
          onClick={handleZoomIn}
        >
          <Plus className="h-6 w-6 text-gray-700" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="bg-white p-2 rounded-full shadow-md hover:bg-gray-100"
          onClick={handleZoomOut}
        >
          <Minus className="h-6 w-6 text-gray-700" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="bg-white p-2 rounded-full shadow-md hover:bg-gray-100"
          onClick={handleLocateMe}
        >
          <MapPin className="h-6 w-6 text-gray-700" />
        </Button>
      </div>
    </div>
  );
}