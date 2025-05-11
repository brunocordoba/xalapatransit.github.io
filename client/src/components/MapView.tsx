import { useEffect, useRef, useState } from 'react';
import { Plus, Minus, MapPin, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BusRoute, BusStop } from '@shared/schema';
import { initializeMap, drawRoutes, highlightRoute, addBusStops, RouteLayers } from '@/lib/mapUtils';
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
};

export default function MapView({ 
  routes, 
  selectedRouteId, 
  toggleSidebar, 
  isSidebarVisible,
  isMobile,
  onRouteSelect 
}: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const routeLayersRef = useRef<Record<number, RouteLayers>>({});
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
  
  // Variable para almacenar un identificador de timeout para debouncing
  const drawTimeoutRef = useRef<number | null>(null);
  
  // Dibujar todas las rutas en el mapa con optimización
  useEffect(() => {
    if (mapReady && mapInstanceRef.current && routes.length > 0) {
      // Debounce para evitar múltiples renderizados en cambios rápidos
      if (drawTimeoutRef.current) {
        window.clearTimeout(drawTimeoutRef.current);
      }
      
      // Usar un loading state para indicar que estamos dibujando
      mapInstanceRef.current.getContainer().classList.add('loading-routes');
      
      // Dibujar rutas con un leve retraso para permitir al DOM actualizarse
      drawTimeoutRef.current = window.setTimeout(() => {
        const { layers, map } = drawRoutes(mapInstanceRef.current!, routes, (routeId) => {
          // Cuando se hace clic en una ruta, manejar la selección
          if (routeId !== selectedRouteId && onRouteSelect) {
            onRouteSelect(routeId);
          }
        });
        
        routeLayersRef.current = layers;
        mapInstanceRef.current!.getContainer().classList.remove('loading-routes');
        drawTimeoutRef.current = null;
      }, 50);
    }
    
    // Limpieza en desmontaje
    return () => {
      if (drawTimeoutRef.current) {
        window.clearTimeout(drawTimeoutRef.current);
      }
    };
  }, [mapReady, routes, selectedRouteId, onRouteSelect]);
  
  // Destacar la ruta seleccionada con optimización
  useEffect(() => {
    if (mapReady && mapInstanceRef.current && routes.length > 0 && Object.keys(routeLayersRef.current).length > 0) {
      highlightRoute(mapInstanceRef.current, routeLayersRef.current, selectedRouteId);
    }
  }, [mapReady, selectedRouteId]); // Eliminar la dependencia 'routes' para evitar recálculos innecesarios
  
  // Añadir paradas al mapa con optimización
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !selectedRouteId) {
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
    <div className="flex-grow relative">
      <div ref={mapContainerRef} className="h-full w-full" />
      
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
      </div>
    </div>
  );
}
