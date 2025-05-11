import { useEffect, useRef, useState } from 'react';
import { Plus, Minus, MapPin, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BusRoute } from '@shared/schema';
import { initializeMap, drawRoutes, highlightRoute, getBusStopIcon } from '@/lib/mapUtils';
import { XALAPA_CENTER, DEFAULT_ZOOM } from '@/lib/constants';

type MapViewProps = {
  routes: BusRoute[];
  selectedRouteId: number | null;
  toggleSidebar: () => void;
  isSidebarVisible: boolean;
  isMobile: boolean;
};

export default function MapView({ 
  routes, 
  selectedRouteId, 
  toggleSidebar, 
  isSidebarVisible,
  isMobile 
}: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const routeLayersRef = useRef<Record<number, L.Polyline>>({});
  
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
  
  // Draw all routes on the map
  useEffect(() => {
    if (mapReady && mapInstanceRef.current && routes.length > 0) {
      const { layers, map } = drawRoutes(mapInstanceRef.current, routes, (routeId) => {
        // When a route is clicked, handle selection
        if (routeId !== selectedRouteId) {
          // If clicking a different route, select it
          // You could call a function here to update the selectedRouteId state in the parent component
        }
      });
      
      routeLayersRef.current = layers;
    }
  }, [mapReady, routes]);
  
  // Highlight selected route
  useEffect(() => {
    if (mapReady && mapInstanceRef.current && routes.length > 0) {
      highlightRoute(mapInstanceRef.current, routeLayersRef.current, selectedRouteId);
    }
  }, [mapReady, selectedRouteId, routes]);
  
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
