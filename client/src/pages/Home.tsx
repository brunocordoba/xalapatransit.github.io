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
  const [showSidebar, setShowSidebar] = useState(true); // Siempre visible por defecto
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [selectedZone, setSelectedZone] = useState<string>('all');
  const [showAllRoutes, setShowAllRoutes] = useState(false); // Inicialmente no mostrar rutas

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
    // En dispositivos móviles, solo ocultamos el panel si no estaba seleccionada ninguna ruta
    if (isMobile && selectedRouteId === null) {
      setShowSidebar(false);
    }
  };

  const handleCloseRouteDetail = () => {
    setSelectedRouteId(null);
  };

  const handleZoneSelect = (zone: string) => {
    setSelectedZone(zone);
  };

  // Función para limpiar selección de rutas
  const handleClearSelection = () => {
    setSelectedRouteId(null);
    // Asegurarse de que el panel lateral sea visible después de limpiar
    if (isMobile) {
      setShowSidebar(true);
    }
  };

  // Función para alternar la visibilidad de todas las rutas
  const toggleAllRoutes = () => {
    setShowAllRoutes(!showAllRoutes);
    // Si estábamos ocultando rutas y ahora queremos mostrarlas, eliminamos cualquier selección
    if (!showAllRoutes) {
      setSelectedRouteId(null);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />
      
      <div className="flex-grow flex relative overflow-hidden">
        <SidePanel 
          show={showSidebar}
          popularRoutes={popularRoutes}
          allRoutes={filteredRoutes || []}
          selectedZone={selectedZone}
          selectedRouteId={selectedRouteId}
          onZoneSelect={handleZoneSelect}
          onRouteSelect={handleRouteSelect}
          onClearSelection={handleClearSelection}
          onToggleAllRoutes={toggleAllRoutes}
          showAllRoutes={showAllRoutes}
          isLoading={routesLoading}
        />
        
        <MapView 
          routes={routes || []}
          selectedRouteId={selectedRouteId}
          toggleSidebar={toggleSidebar}
          isSidebarVisible={showSidebar}
          isMobile={isMobile}
          onRouteSelect={handleRouteSelect}
          onClearSelection={handleClearSelection}
          onToggleAllRoutes={toggleAllRoutes}
          showAllRoutes={showAllRoutes}
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
