import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import AllRoutesPanel from './AllRoutesPanel';
import { BusRoute } from '@shared/schema';

type AllRoutesButtonPortalProps = {
  routes: BusRoute[];
  isLoading: boolean;
  onRouteSelect: (routeId: number) => void;
  selectedRouteId: number | null;
};

export default function AllRoutesButtonPortal({
  routes,
  isLoading,
  onRouteSelect,
  selectedRouteId
}: AllRoutesButtonPortalProps) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);
  
  // El contenedor donde queremos renderizar el botón
  const container = document.getElementById('all-routes-container');
  
  if (!mounted || !container) return null;
  
  return createPortal(
    <AllRoutesPanel 
      routes={routes} 
      isLoading={isLoading} 
      onRouteSelect={onRouteSelect} 
      selectedRouteId={selectedRouteId} 
    />,
    container
  );
}