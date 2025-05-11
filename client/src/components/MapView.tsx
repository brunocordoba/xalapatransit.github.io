import { useEffect, useRef, useState } from 'react';
import { Plus, Minus, MapPin, Menu, Layers, Eye } from 'lucide-react';
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
  const [showAllRoutes, setShowAllRoutes] = useState(true);
  
  // Cargar las paradas para la ruta seleccionada
  const { data: stops } = useQuery<BusStop[]>({
    queryKey: ['stops', selectedRouteId],
    queryFn: async () => {
      if (!selectedRouteId) return [];
      try {
        const response = await fetch(`/api/routes/${selectedRouteId}/stops`);
        if (!response.ok) {
          console.warn(`No se pudieron cargar paradas para la ruta ${selectedRouteId}`);
          return [];
        }
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      } catch (error) {
        console.error(`Error al cargar paradas: ${error}`);
        return [];
      }
    },
    enabled: !!selectedRouteId && mapReady,
    // Añadir opciones de caché y reintento para mejorar rendimiento
    staleTime: 300000, // 5 minutos
    retry: 1,
    retryDelay: 1000
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
  
  // Dibujar todas las rutas en el mapa con optimización avanzada
  useEffect(() => {
    if (mapReady && mapInstanceRef.current && routes.length > 0) {
      // Debounce para evitar múltiples renderizados en cambios rápidos
      if (drawTimeoutRef.current) {
        window.clearTimeout(drawTimeoutRef.current);
      }
      
      // Indicar visualmente que estamos cargando
      if (mapInstanceRef.current.getContainer()) {
        mapInstanceRef.current.getContainer().classList.add('loading-routes');
      }
      
      // Dibujar rutas con un retraso para evitar bloqueo de UI
      drawTimeoutRef.current = window.setTimeout(() => {
        try {
          console.log(`Dibujando ${routes.length} rutas en el mapa`);
          
          // Si hay demasiadas rutas, aplicar muestreo para mejorar rendimiento
          let routesToRender = routes;
          if (routes.length > 100 && !selectedRouteId) {
            // Tomar sólo rutas populares y una muestra del resto
            const popularRoutes = routes.filter(r => r.popular);
            const otherRoutes = routes.filter(r => !r.popular);
            const sampleSize = Math.min(50, otherRoutes.length);
            const sampledRoutes = otherRoutes
              .sort(() => 0.5 - Math.random()) // Mezclar aleatoriamente
              .slice(0, sampleSize);
            
            routesToRender = [...popularRoutes, ...sampledRoutes];
            console.log(`Optimizando: mostrando ${routesToRender.length} de ${routes.length} rutas`);
          }
          
          // Dibujar las rutas con la función optimizada, pasando el ID de ruta seleccionada
          const { layers, map } = drawRoutes(
            mapInstanceRef.current!, 
            routesToRender, 
            (routeId) => {
              // Cuando se hace clic en una ruta, manejar la selección
              if (routeId !== selectedRouteId && onRouteSelect) {
                onRouteSelect(routeId);
              }
            },
            selectedRouteId // Pasar ID de ruta seleccionada para optimizaciones
          );
          
          routeLayersRef.current = layers;
          
          // Si hay una ruta seleccionada, asegurarse de que esté visible
          if (selectedRouteId && !routeLayersRef.current[selectedRouteId] && routes.find(r => r.id === selectedRouteId)) {
            console.log(`Añadiendo ruta seleccionada ${selectedRouteId} que faltaba`);
            const selectedRoute = routes.find(r => r.id === selectedRouteId);
            if (selectedRoute) {
              const singleResult = drawRoutes(
                mapInstanceRef.current!, 
                [selectedRoute], 
                (routeId) => {
                  if (onRouteSelect) onRouteSelect(routeId);
                },
                selectedRouteId
              );
              routeLayersRef.current[selectedRouteId] = singleResult.layers[selectedRouteId];
            }
          }
        } catch (error) {
          console.error('Error al dibujar rutas:', error);
        } finally {
          // Siempre quitar el estado de carga
          if (mapInstanceRef.current && mapInstanceRef.current.getContainer()) {
            mapInstanceRef.current.getContainer().classList.remove('loading-routes');
          }
          drawTimeoutRef.current = null;
        }
      }, 100); // Aumentar ligeramente el retraso para evitar bloqueo de UI
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
      highlightRoute(mapInstanceRef.current, routeLayersRef.current, selectedRouteId, showAllRoutes);
    }
  }, [mapReady, selectedRouteId, showAllRoutes]); // Añadimos showAllRoutes como dependencia
  
  // Cuando se selecciona una ruta, cambiar automáticamente a modo "solo esta ruta"
  useEffect(() => {
    // Siempre que haya una ruta seleccionada, OCULTAMOS todas las demás
    if (selectedRouteId) {
      setShowAllRoutes(false);
    } else {
      setShowAllRoutes(true); // Si no hay ruta seleccionada, mostrar todas
    }
  }, [selectedRouteId]);
  
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
  
  const toggleShowAllRoutes = () => {
    setShowAllRoutes(!showAllRoutes);
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
        
        {/* Botón para mostrar/ocultar rutas - más visible y siempre presente */}
        <Button
          variant="outline"
          size="icon"
          className={`p-2 rounded-full shadow-md ${showAllRoutes ? 'bg-blue-500 hover:bg-blue-600' : 'bg-white hover:bg-gray-100'}`}
          onClick={toggleShowAllRoutes}
          title={showAllRoutes ? "Mostrar solo la ruta seleccionada" : "Mostrar todas las rutas"}
        >
          <Eye className={`h-6 w-6 ${showAllRoutes ? 'text-white' : 'text-gray-700'}`} />
        </Button>
      </div>
      
      {/* Indicador de ruta seleccionada */}
      {selectedRouteId && !showAllRoutes && (
        <div className="absolute bottom-4 left-4 bg-white px-4 py-2 rounded-lg shadow-md">
          <p className="text-sm font-medium">
            Solo mostrando la ruta seleccionada en el mapa. 
            <button 
              onClick={toggleShowAllRoutes}
              className="ml-2 text-blue-600 underline hover:text-blue-800 focus:outline-none"
            >
              Ver todas
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
