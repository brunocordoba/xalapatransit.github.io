import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BusRoute, BusStop } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { MapPin, Loader2, Navigation, Bus } from 'lucide-react';
import RouteMapView from '../components/RouteMapView';

interface NearbyStop extends BusStop {
  distance: number;
  coordinates: [number, number]; // [longitude, latitude]
}

interface NearbyStopsResponse {
  stops: NearbyStop[];
  routes: {
    id: number;
    name: string;
    shortName: string;
    color: string;
  }[];
}

export default function NearbyStops() {
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [selectedStop, setSelectedStop] = useState<NearbyStop | null>(null);
  const [selectedRoutes, setSelectedRoutes] = useState<number[]>([]);
  
  // Estado para controlar la búsqueda
  const [maxDistance, setMaxDistance] = useState(1000); // Default 1km
  const [isSearching, setIsSearching] = useState(false);
  
  // Consultar paradas cercanas cuando tengamos la ubicación del usuario
  const { 
    data: nearbyStopsData, 
    isLoading: nearbyStopsLoading, 
    refetch 
  } = useQuery<NearbyStopsResponse>({
    queryKey: ['nearby-stops', userLocation],
    queryFn: async () => {
      if (!userLocation) {
        return { stops: [], routes: [] };
      }
      
      const response = await fetch('/api/nearby-stops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          latitude: userLocation[1],
          longitude: userLocation[0],
          maxDistance,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Error al buscar paradas cercanas');
      }
      
      return response.json();
    },
    enabled: !!userLocation, // Solo activar la consulta cuando tengamos ubicación
  });
  
  // Función para obtener la ubicación del usuario
  const getUserLocation = () => {
    if (!navigator.geolocation) {
      alert('La geolocalización no está disponible en tu navegador');
      return;
    }
    
    setIsGettingLocation(true);
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude } = position.coords;
        setUserLocation([longitude, latitude]);
        setIsGettingLocation(false);
        setIsSearching(true);
      },
      (error) => {
        console.error('Error obteniendo ubicación:', error);
        alert('No se pudo obtener tu ubicación. ' + error.message);
        setIsGettingLocation(false);
      },
      { enableHighAccuracy: true }
    );
  };
  
  // Manejar selección de parada
  const handleStopSelect = (stop: NearbyStop) => {
    setSelectedStop(stop);
    
    // Cuando se selecciona una parada, obtener las rutas que pasan por ella
    if (nearbyStopsData?.routes) {
      const routesToShow = nearbyStopsData.routes
        .filter(route => route.id === stop.routeId)
        .map(route => route.id);
      
      setSelectedRoutes(routesToShow);
    }
  };
  
  // Cuando se carga el componente, intentar obtener ubicación automáticamente
  useEffect(() => {
    getUserLocation();
  }, []);
  
  // Efecto para refrescar la consulta cuando cambia la distancia máxima
  useEffect(() => {
    if (userLocation && isSearching) {
      refetch();
    }
  }, [maxDistance, refetch, userLocation, isSearching]);
  
  return (
    <div className="container mx-auto p-4 max-w-7xl">
      <div className="flex items-center mb-4">
        <a href="/" className="flex items-center">
          <div className="w-10 h-10 rounded-full bg-[#4caf50] flex items-center justify-center text-white font-bold mr-2 text-xs">RX</div>
          <span className="text-[#4caf50] font-semibold">RUTAS XALAPA</span>
        </a>
        <a href="/" className="ml-auto text-sm text-[#4caf50] hover:underline flex items-center">
          <span>Volver al sitio</span>
          <svg xmlns="http://www.w3.org/2000/svg" className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </a>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Panel de búsqueda y resultados */}
        <div className="col-span-1">
          <div className="space-y-4">
            <Card className="shadow-lg overflow-hidden border-0">
              <CardHeader className="pb-2 bg-[#4caf50] text-white">
                <CardTitle className="text-xl text-center font-bold">
                  PARADAS CERCANAS
                </CardTitle>
                <CardDescription className="text-center text-white">
                  Encuentra las paradas de autobús más cercanas a tu ubicación
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Button
                    onClick={getUserLocation}
                    disabled={isGettingLocation}
                    className="w-full py-3 text-base font-bold bg-[#4caf50] text-white hover:bg-[#3d8b40] rounded-none shadow-md uppercase"
                  >
                    {isGettingLocation ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Obteniendo ubicación...
                      </>
                    ) : (
                      <>
                        <Navigation className="mr-2 h-4 w-4" />
                        {userLocation ? 'Actualizar ubicación' : 'Obtener mi ubicación'}
                      </>
                    )}
                  </Button>
                </div>
                
                {userLocation && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Radio de búsqueda: {maxDistance} metros
                    </label>
                    <Input
                      type="range"
                      min={100}
                      max={5000}
                      step={100}
                      value={maxDistance}
                      onChange={(e) => setMaxDistance(parseInt(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>100m</span>
                      <span>1km</span>
                      <span>5km</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Lista de paradas cercanas */}
            {nearbyStopsLoading ? (
              <Card>
                <CardContent className="py-4 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Buscando paradas cercanas...</span>
                </CardContent>
              </Card>
            ) : nearbyStopsData && nearbyStopsData.stops.length > 0 ? (
              <Card className="shadow-lg border-0">
                <CardHeader className="pb-2 bg-[#4caf50] text-white">
                  <CardTitle className="text-lg font-bold text-center">
                    {nearbyStopsData.stops.length} PARADAS ENCONTRADAS
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-[60vh] overflow-y-auto">
                    {nearbyStopsData.stops.map((stop) => {
                      // Buscar información de la ruta
                      const routeInfo = nearbyStopsData.routes.find(r => r.id === stop.routeId);
                      
                      return (
                        <div 
                          key={stop.id}
                          onClick={() => handleStopSelect(stop)}
                          className={`p-4 border-b last:border-b-0 hover:bg-accent/10 cursor-pointer transition-colors ${
                            selectedStop?.id === stop.id ? 'bg-accent/20' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-start space-x-3">
                              <div 
                                className="flex-shrink-0 rounded-full w-8 h-8 flex items-center justify-center text-white text-sm font-bold"
                                style={{ backgroundColor: routeInfo?.color || '#0056A4' }}
                              >
                                {routeInfo?.shortName?.replace('R', '') || 'R'}
                              </div>
                              
                              <div>
                                <h3 className="font-semibold">{stop.name}</h3>
                                <p className="text-sm text-muted-foreground">
                                  {routeInfo?.name || 'Ruta desconocida'}
                                </p>
                              </div>
                            </div>
                            
                            <div className="text-right">
                              <span className="inline-block bg-primary/10 text-primary rounded-full px-2 py-1 text-xs font-semibold">
                                {stop.distance}m
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ) : userLocation && !nearbyStopsLoading ? (
              <Card className="shadow-lg border-0">
                <CardHeader className="pb-2 bg-[#4caf50] text-white">
                  <CardTitle className="text-lg font-bold text-center">
                    NINGUNA PARADA ENCONTRADA
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-4 text-center">
                  <p>No se encontraron paradas cercanas en un radio de {maxDistance}m.</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Intenta aumentar el radio de búsqueda.
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>

        {/* Mapa */}
        <div className="col-span-1 lg:col-span-2">
          <Card className="h-[calc(100vh-2rem)]">
            <CardContent className="p-0 h-full">
              <RouteMapView 
                routes={nearbyStopsData?.routes.map(r => ({
                  id: r.id,
                  name: r.name,
                  shortName: r.shortName,
                  color: r.color,
                  geoJSON: {} // No necesitamos el geoJSON completo para esto
                } as BusRoute)) || []} 
                selectedRoutes={selectedRoutes}
                walkingPoints={
                  userLocation && selectedStop 
                    ? { 
                        startPoint: [userLocation[1], userLocation[0]], // [lat, lng] para Leaflet
                        endPoint: [
                          selectedStop.coordinates[1] || 0, 
                          selectedStop.coordinates[0] || 0
                        ] 
                      } 
                    : undefined
                }
                showStops={true}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}