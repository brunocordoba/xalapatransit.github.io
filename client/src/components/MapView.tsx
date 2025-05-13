import { useEffect, useRef, useState } from 'react';
import { Plus, Minus, MapPin, Menu, XCircle, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BusRoute, BusStop } from '@shared/schema';
import { initializeMap, addBusStops } from '@/lib/mapUtils';
import { XALAPA_CENTER, DEFAULT_ZOOM } from '@/lib/constants';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';

type MapViewProps = {
  routes: BusRoute[];
  selectedRouteId: number | null;
  toggleSidebar: () => void;
  isSidebarVisible: boolean;
  isMobile: boolean;
  onRouteSelect?: (routeId: number) => void;
  onClearSelection: () => void;
  onToggleAllRoutes: () => void;
  showAllRoutes: boolean;
};

// Función auxiliar para dibujar una sola ruta
function drawSingleRoute(
  map: L.Map,
  route: BusRoute,
  isSelected: boolean,
  onRouteClick: (routeId: number) => void
): {routeLine: L.Polyline, routeOutline: L.Polyline, shadowLine: L.Polyline} {
  try {
    console.log("Dibujando ruta:", route.id);
    
    // Extraer coordenadas del GeoJSON
    let coordinates: [number, number][] = [];
    
    try {
      // Parsear el GeoJSON si es string
      let geoJSON: any;
      if (typeof route.geoJSON === 'string') {
        geoJSON = JSON.parse(route.geoJSON);
      } else {
        geoJSON = route.geoJSON;
      }
      
      if (geoJSON?.type === 'FeatureCollection' && 
          Array.isArray(geoJSON.features) && 
          geoJSON.features.length > 0 && 
          geoJSON.features[0].geometry?.type === 'LineString') {
        // Formato estándar: FeatureCollection con LineString
        coordinates = geoJSON.features[0].geometry.coordinates;
        console.log(`Usando coordenadas desde GeoJSON: ${coordinates.length} puntos`);
      } else {
        throw new Error("Formato GeoJSON no reconocido");
      }
    } catch (error) {
      console.warn(`Error al procesar GeoJSON: ${error}. Usando coordenadas por defecto`);
      
      // Coordenadas de respaldo si hay error
      coordinates = [
        [-96.9270, 19.5438],
        [-96.9265, 19.5428],
        [-96.9260, 19.5418],
        [-96.9255, 19.5408],
        [-96.9250, 19.5398],
        [-96.9245, 19.5388],
        [-96.9240, 19.5378],
        [-96.9235, 19.5368],
        [-96.9230, 19.5358],
        [-96.9225, 19.5348]
      ];
    }
    
    // Convertir coordenadas a formato Leaflet [lat, lng]
    const leafletCoords = coordinates.map(coord => [coord[1], coord[0]] as [number, number]);
    
    console.log(`Dibujando ruta ${route.id} con ${leafletCoords.length} puntos`);
    
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
    
    // Agregar eventos solo a la línea principal
    routeLine.on('click', () => {
      onRouteClick(route.id);
    });
    
    // Optimizar el hover
    routeLine.on('mouseover', () => {
      if (!routeLine.options.className?.includes('hover')) {
        routeLine.setStyle({
          className: routeLine.options.className + ' hover'
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
    
    return { routeLine, routeOutline, shadowLine };
  } catch (error) {
    console.error(`Error al dibujar la ruta ${route.id}:`, error);
    return {} as any;
  }
}

export default function MapView({ 
  routes, 
  selectedRouteId, 
  toggleSidebar, 
  isSidebarVisible,
  isMobile,
  onRouteSelect,
  onClearSelection,
  onToggleAllRoutes,
  showAllRoutes
}: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const routeLayersRef = useRef<Map<number, {routeLine: L.Polyline, routeOutline: L.Polyline, shadowLine: L.Polyline}>>(new Map());
  const stopMarkersRef = useRef<L.Marker[]>([]);
  
  const [mapReady, setMapReady] = useState(false);
  
  // Cargar las paradas para la ruta seleccionada
  const { data: stops } = useQuery<BusStop[]>({
    queryKey: ['stops', selectedRouteId],
    queryFn: async () => {
      if (!selectedRouteId) return [];
      const response = await fetch(`/api/routes/${selectedRouteId}/stops`);
      if (!response.ok) {
        throw new Error('Error al cargar las paradas');
      }
      return response.json();
    },
    enabled: !!selectedRouteId && mapReady
  });
  
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
  
  // Efecto para manejar la visualización de rutas según la selección y la visibilidad global
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
    
    // Si no queremos mostrar rutas, terminamos aquí
    if (!showAllRoutes && selectedRouteId === null) {
      return;
    }
    
    if (selectedRouteId === null && showAllRoutes) {
      // Si no hay ruta seleccionada pero queremos mostrar todas, dibujar todas
      routes.forEach(route => {
        const layers = drawSingleRoute(map, route, false, (routeId) => {
          if (onRouteSelect) {
            onRouteSelect(routeId);
          }
        });
        
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
      });
    } else if (selectedRouteId !== null) {
      // Si hay una ruta seleccionada, mostrar solo esa ruta
      const selectedRoute = routes.find(r => r.id === selectedRouteId);
      if (selectedRoute) {
        const layers = drawSingleRoute(map, selectedRoute, true, (routeId) => {
          if (onRouteSelect) {
            onRouteSelect(routeId);
          }
        });
        
        // Añadir las capas al mapa
        layers.shadowLine.addTo(map);
        layers.routeOutline.addTo(map);
        layers.routeLine.addTo(map);
        
        // Asegurar el orden correcto de las capas
        layers.shadowLine.bringToBack();
        layers.routeOutline.bringToFront();
        layers.routeLine.bringToFront();
        
        // Agregar efecto de pulsación a la ruta seleccionada
        const pathElement = layers.routeLine.getElement();
        if (pathElement) {
          pathElement.classList.add('pulse-animation');
        }
        
        // Guardar referencia a las capas
        routeLayersRef.current.set(selectedRoute.id, layers);
        
        // Centrar el mapa en la ruta seleccionada
        try {
          const bounds = layers.routeLine.getBounds();
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
    }
  }, [mapReady, routes, selectedRouteId, showAllRoutes, onRouteSelect]);
  
  // Añadir paradas al mapa con optimización
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !selectedRouteId) {
      // Limpiar marcadores anteriores si no hay ruta seleccionada
      stopMarkersRef.current.forEach(marker => marker.remove());
      stopMarkersRef.current = [];
      return;
    }
    
    // Limpiar marcadores anteriores
    stopMarkersRef.current.forEach(marker => marker.remove());
    stopMarkersRef.current = [];
    
    // Si no hay paradas o son vacías, terminamos
    if (!stops || stops.length === 0) return;
    
    // Encontrar la ruta seleccionada
    const selectedRoute = routes.find(route => route.id === selectedRouteId);
    if (!selectedRoute) return;
    
    console.log(`Mostrando ${stops.length} paradas para la ruta ${selectedRouteId}`);
    
    // Añadir nuevos marcadores de parada (optimizado)
    const newMarkers = addBusStops(
      mapInstanceRef.current,
      selectedRouteId,
      stops,
      selectedRoute.color
    );
    
    stopMarkersRef.current = newMarkers;
  }, [mapReady, selectedRouteId, stops]);
  
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
    <div className="flex-grow relative h-full w-full">
      <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />
      
      {/* Map Controls */}
      <div className="absolute top-4 right-4 flex flex-col space-y-2">
        {isMobile && (
          <Button
            variant="outline"
            size="icon"
            className="bg-white p-2 rounded-full shadow-md hover:bg-gray-100"
            onClick={toggleSidebar}
          >
            <Menu className="h-6 w-6 text-gray-700" />
          </Button>
        )}
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
        
        {/* Botón de ojo para mostrar/ocultar todas las rutas */}
        <Button
          variant="outline"
          size="icon"
          className={`bg-white p-2 rounded-full shadow-md ${showAllRoutes ? 'bg-blue-50 text-blue-600' : 'text-gray-700'}`}
          onClick={onToggleAllRoutes}
          title={showAllRoutes ? "Ocultar todas las rutas" : "Mostrar todas las rutas"}
        >
          {showAllRoutes ? (
            <Eye className="h-6 w-6" />
          ) : (
            <EyeOff className="h-6 w-6" />
          )}
        </Button>
        
        {/* Botón para limpiar selección solo cuando hay una ruta seleccionada */}
        {selectedRouteId && (
          <Button
            variant="outline"
            size="icon"
            className="bg-white p-2 rounded-full shadow-md hover:bg-red-100"
            onClick={onClearSelection}
            title="Limpiar selección"
          >
            <XCircle className="h-6 w-6 text-red-500" />
          </Button>
        )}
      </div>
    </div>
  );
}