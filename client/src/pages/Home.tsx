import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Header from '@/components/Header';
import SidePanel from '@/components/SidePanel';
import MapView from '@/components/MapView';
import RouteDetail from '@/components/RouteDetail';
import { BusRoute, BusStop } from '@shared/schema';
import { useIsMobile } from '@/hooks/use-mobile';

export default function Home() {
  const isMobile = useIsMobile();
  const [showSidebar, setShowSidebar] = useState(!isMobile);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [selectedZone, setSelectedZone] = useState<string>('all');

  // Fetch all routes
  const { data: routes, isLoading: routesLoading } = useQuery<BusRoute[]>({
    queryKey: ['/api/routes'],
  });

  // Fetch stops for the selected route
  const { data: stops, isLoading: stopsLoading } = useQuery<BusStop[]>({
    queryKey: ['/api/routes', selectedRouteId, 'stops'],
    enabled: !!selectedRouteId,
  });

  const selectedRoute = routes?.find(route => route.id === selectedRouteId);
  const popularRoutes = routes?.filter(route => route.popular) || [];
  
  const filteredRoutes = selectedZone === 'all' 
    ? routes 
    : routes?.filter(route => route.zone === selectedZone);

  const toggleSidebar = () => {
    setShowSidebar(!showSidebar);
  };

  const handleRouteSelect = (routeId: number) => {
    setSelectedRouteId(routeId);
    if (isMobile) {
      setShowSidebar(false);
    }
  };

  const handleCloseRouteDetail = () => {
    setSelectedRouteId(null);
  };

  const handleZoneSelect = (zone: string) => {
    setSelectedZone(zone);
  };

  // Update sidebar visibility when screen size changes
  useEffect(() => {
    setShowSidebar(!isMobile);
  }, [isMobile]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />
      
      <div className="flex-grow flex relative overflow-hidden">
        <SidePanel 
          show={showSidebar}
          popularRoutes={popularRoutes}
          allRoutes={filteredRoutes || []}
          selectedZone={selectedZone}
          onZoneSelect={handleZoneSelect}
          onRouteSelect={handleRouteSelect}
          isLoading={routesLoading}
        />
        
        <MapView 
          routes={routes || []}
          selectedRouteId={selectedRouteId}
          toggleSidebar={toggleSidebar}
          isSidebarVisible={showSidebar}
          isMobile={isMobile}
        />
        
        {selectedRoute && (
          <RouteDetail 
            route={selectedRoute} 
            stops={stops || []}
            onClose={handleCloseRouteDetail} 
            isLoading={stopsLoading}
          />
        )}
      </div>
    </div>
  );
}
