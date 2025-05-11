import { useEffect, useRef, useState } from 'react';
import { Plus, Minus, MapPin, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BusRoute, BusStop } from '@shared/schema';
import { initializeMap, drawRoutes, highlightRoute, addBusStops } from '@/lib/mapUtils-fixed';
import { XALAPA_CENTER, DEFAULT_ZOOM } from '@/lib/constants';
import { useQuery } from '@tanstack/react-query';

// Importamos la clase RouteLayers del nuevo archivo
import { RouteLayers } from '@/lib/mapUtils-fixed';

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
  
  // Fetch stops for the selected route
  const { data: stops } = useQuery({
    queryKey: ['/api/stops', selectedRouteId],
    enabled: selectedRouteId !== null,
  });
  
  // Initialize map on component mount
  useEffect(() => {
    if (mapContainerRef.current && !mapInstanceRef.current) {
      mapInstanceRef.current = initializeMap(mapContainerRef.current, XALAPA_CENTER, DEFAULT_ZOOM);
      setMapReady(true);
    }
    
    // Cleanup on unmount
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);
  
  // Draw routes when map is ready and routes are loaded
  useEffect(() => {
    if (mapReady && mapInstanceRef.current && routes.length > 0) {
      const handleRouteClick = (routeId: number) => {
        if (onRouteSelect) {
          onRouteSelect(routeId);
        }
      };
      
      const { layers } = drawRoutes(mapInstanceRef.current, routes, handleRouteClick);
      
      routeLayersRef.current = layers;
    }
  }, [mapReady, routes, selectedRouteId, onRouteSelect]);
  
  // Highlight selected route
  useEffect(() => {
    if (mapReady && mapInstanceRef.current && routes.length > 0) {
      highlightRoute(mapInstanceRef.current, routeLayersRef.current, selectedRouteId);
    }
  }, [mapReady, selectedRouteId, routes]);
  
  // Add bus stops to map when a route is selected and stops are loaded
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !selectedRouteId || !stops || stops.length === 0) {
      return;
    }
    
    // Clear previous stop markers
    stopMarkersRef.current.forEach(marker => marker.remove());
    stopMarkersRef.current = [];
    
    // Find selected route
    const selectedRoute = routes.find(route => route.id === selectedRouteId);
    if (!selectedRoute) return;
    
    console.log(`Mostrando ${stops.length} paradas para la ruta ${selectedRouteId}`);
    
    // Add new stop markers
    const newMarkers = addBusStops(
      mapInstanceRef.current,
      selectedRouteId,
      stops,
      selectedRoute.color
    );
    
    stopMarkersRef.current = newMarkers;
    
  }, [mapReady, selectedRouteId, stops, routes]);
  
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
  
  return (
    <div className="relative w-full h-full bg-gray-100">
      {/* Map Container */}
      <div 
        ref={mapContainerRef} 
        className="w-full h-full z-0"
      />
      
      {/* Zoom Controls */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-2 z-10">
        <Button variant="secondary" size="icon" onClick={handleZoomIn} className="h-10 w-10 rounded-full shadow-md">
          <Plus className="h-5 w-5" />
        </Button>
        <Button variant="secondary" size="icon" onClick={handleZoomOut} className="h-10 w-10 rounded-full shadow-md">
          <Minus className="h-5 w-5" />
        </Button>
      </div>
      
      {/* Mobile Sidebar Toggle */}
      {isMobile && (
        <Button 
          variant="secondary" 
          size="icon" 
          onClick={toggleSidebar}
          className="absolute top-4 left-4 h-10 w-10 rounded-full shadow-md z-10"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}
      
      {/* Current Route Info */}
      {selectedRouteId && (
        <div className="absolute top-4 right-4 bg-white dark:bg-gray-800 rounded-lg shadow-md p-3 max-w-xs z-10">
          <h3 className="text-sm font-semibold">
            {routes.find(r => r.id === selectedRouteId)?.name || 'Ruta seleccionada'}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {stops?.length || 0} paradas • Zona {routes.find(r => r.id === selectedRouteId)?.zone || 'N/A'}
          </p>
        </div>
      )}
    </div>
  );
}