import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarIcon, Clock10Icon, Clock3Icon, ArrowUpDown, MapPin, XIcon, Map, SearchIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import RouteMapView from "../components/RouteMapView";
import { useQuery } from "@tanstack/react-query";
import { BusRoute } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

// Definición de zonas para filtrado
const zones = [
  { value: 'norte', label: 'Norte' },
  { value: 'sur', label: 'Sur' },
  { value: 'este', label: 'Este' },
  { value: 'oeste', label: 'Oeste' },
  { value: 'centro', label: 'Centro' }
];

// Interfaz de tipo para la ruta de autobús
interface BusRouteType {
  id: number;
  name: string;
  shortName: string;
  color: string;
  frequency: string;
  stopsCount: number;
  zone: string;
}

const RoutePlanner: React.FC = () => {
  const [startLocation, setStartLocation] = useState("");
  const [endLocation, setEndLocation] = useState("");
  const { toast } = useToast();
  const [date, setDate] = useState<Date>(new Date());
  const [departureTime, setDepartureTime] = useState<string>("12:00");
  const [arrivalTime, setArrivalTime] = useState<string>("13:00");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isArrival, setIsArrival] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [routeResults, setRouteResults] = useState<any[] | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedZone, setSelectedZone] = useState<string>('all');
  
  // Cargar todas las rutas para poder mostrarlas en el mapa
  const { data: routes, isLoading: routesLoading } = useQuery<BusRoute[]>({
    queryKey: ['/api/routes'],
  });
  
  // Filtrar y ordenar rutas para el panel de Todas las Rutas
  const filteredAndSortedRoutes = React.useMemo(() => {
    if (!routes) return [];
    
    // Filtrar por zona
    const zoneFiltered = selectedZone === 'all' 
      ? routes 
      : routes.filter(route => route.zone === selectedZone);
    
    // Filtrar por término de búsqueda
    const searchFiltered = zoneFiltered.filter(route => 
      route.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      route.shortName.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    // Ordenar por número
    return [...searchFiltered].sort((a, b) => {
      const getRouteNumber = (name: string) => {
        const match = name.match(/Ruta\s+(\d+)/i);
        return match ? parseInt(match[1], 10) : 999;
      };
      
      return getRouteNumber(a.name) - getRouteNumber(b.name);
    });
  }, [routes, selectedZone, searchTerm]);

  const handleSwapLocations = () => {
    const temp = startLocation;
    setStartLocation(endLocation);
    setEndLocation(temp);
  };

  const handleCalculateRoute = async () => {
    setIsCalculating(true);
    
    try {
      const response = await fetch('/api/plan-route', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: startLocation,
          to: endLocation,
          departureTime: isArrival ? null : departureTime,
          arrivalTime: isArrival ? arrivalTime : null,
          isArrival,
          date: date.toISOString()
        }),
      });
      
      if (!response.ok) {
        throw new Error('Error al calcular la ruta');
      }
      
      const results = await response.json();
      setRouteResults(results);
    } catch (error) {
      console.error('Error al planificar ruta:', error);
      toast({
        title: "Error al calcular ruta",
        description: "No se pudo encontrar una ruta entre el origen y destino especificados. Por favor, intenta con otras ubicaciones.",
        variant: "destructive"
      });
    } finally {
      setIsCalculating(false);
    }
  };

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
        {/* Panel de búsqueda */}
        <div className="col-span-1">
          <div className="space-y-4">
            <Card className="shadow-lg overflow-hidden border-0">
              <CardHeader className="pb-2 bg-[#4caf50] text-white">
                <CardTitle className="text-xl text-center font-bold">ITINERARIOS</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                <div className="relative">
                  <div className="absolute left-0 top-0 bottom-0 w-12 bg-[#4caf50] rounded-l-lg flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-white" />
                  </div>
                  <Input 
                    type="text" 
                    value={startLocation}
                    onChange={(e) => setStartLocation(e.target.value)}
                    className="pl-14 h-12 border-2 border-[#4caf50] focus:ring-[#4caf50] focus:border-[#4caf50] rounded-lg" 
                    placeholder="¿Desde dónde sales?" 
                  />
                  {startLocation && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="absolute right-2 top-3 h-6 w-6 rounded-full p-0 hover:bg-gray-100"
                      onClick={() => setStartLocation("")}
                    >
                      <XIcon className="h-4 w-4 text-gray-500" />
                    </Button>
                  )}
                </div>
                
                <div className="flex justify-center -my-1 relative z-10">
                  <Button 
                    variant="outline" 
                    size="icon" 
                    className="rounded-full w-10 h-10 p-0 bg-white border-2 border-[#4caf50] shadow-md hover:bg-gray-50"
                    onClick={handleSwapLocations}
                  >
                    <ArrowUpDown className="h-5 w-5 text-[#4caf50]" />
                  </Button>
                </div>
                
                <div className="relative">
                  <div className="absolute left-0 top-0 bottom-0 w-12 bg-[#4caf50] rounded-l-lg flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-white" />
                  </div>
                  <Input 
                    type="text" 
                    value={endLocation}
                    onChange={(e) => setEndLocation(e.target.value)}
                    className="pl-14 h-12 border-2 border-[#4caf50] focus:ring-[#4caf50] focus:border-[#4caf50] rounded-lg" 
                    placeholder="¿A dónde vas?" 
                  />
                  {endLocation && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="absolute right-2 top-3 h-6 w-6 rounded-full p-0 hover:bg-gray-100"
                      onClick={() => setEndLocation("")}
                    >
                      <XIcon className="h-4 w-4 text-gray-500" />
                    </Button>
                  )}
                </div>
                
                <Tabs defaultValue="departure" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 border-2 border-[#4caf50] p-0 rounded-lg overflow-hidden">
                    <TabsTrigger 
                      value="departure" 
                      onClick={() => setIsArrival(false)}
                      className="rounded-none data-[state=active]:bg-[#4caf50] data-[state=active]:text-white py-3"
                    >
                      Salida
                    </TabsTrigger>
                    <TabsTrigger 
                      value="arrival" 
                      onClick={() => setIsArrival(true)}
                      className="rounded-none data-[state=active]:bg-[#4caf50] data-[state=active]:text-white py-3"
                    >
                      Llegada
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="departure" className="space-y-4 mt-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>Fecha</Label>
                        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-start text-left font-normal border-2"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {date ? format(date, "PPP", { locale: es }) : <span>Seleccionar fecha</span>}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={date}
                              onSelect={(date) => {
                                setDate(date || new Date());
                                setIsCalendarOpen(false);
                              }}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div>
                        <Label>Hora de salida</Label>
                        <div className="relative">
                          <Select defaultValue={departureTime} onValueChange={setDepartureTime}>
                            <SelectTrigger className="w-full border-2">
                              <Clock3Icon className="mr-2 h-4 w-4" />
                              <SelectValue placeholder="Seleccionar hora" />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, i) => i).map(hour => (
                                <React.Fragment key={hour}>
                                  <SelectItem value={`${hour.toString().padStart(2, '0')}:00`}>
                                    {hour.toString().padStart(2, '0')}:00
                                  </SelectItem>
                                  <SelectItem value={`${hour.toString().padStart(2, '0')}:30`}>
                                    {hour.toString().padStart(2, '0')}:30
                                  </SelectItem>
                                </React.Fragment>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="arrival" className="space-y-4 mt-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>Fecha</Label>
                        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-start text-left font-normal border-2"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {date ? format(date, "PPP", { locale: es }) : <span>Seleccionar fecha</span>}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={date}
                              onSelect={(date) => {
                                setDate(date || new Date());
                                setIsCalendarOpen(false);
                              }}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div>
                        <Label>Hora de llegada</Label>
                        <div className="relative">
                          <Select defaultValue={arrivalTime} onValueChange={setArrivalTime}>
                            <SelectTrigger className="w-full border-2">
                              <Clock10Icon className="mr-2 h-4 w-4" />
                              <SelectValue placeholder="Seleccionar hora" />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, i) => i).map(hour => (
                                <React.Fragment key={hour}>
                                  <SelectItem value={`${hour.toString().padStart(2, '0')}:00`}>
                                    {hour.toString().padStart(2, '0')}:00
                                  </SelectItem>
                                  <SelectItem value={`${hour.toString().padStart(2, '0')}:30`}>
                                    {hour.toString().padStart(2, '0')}:30
                                  </SelectItem>
                                </React.Fragment>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
              <CardFooter className="flex flex-col space-y-2">
                <Button 
                  onClick={handleCalculateRoute}
                  disabled={!startLocation || !endLocation || isCalculating}
                  className="w-full py-3 text-base font-bold bg-[#4caf50] text-white hover:bg-[#3d8b40] rounded-none shadow-md uppercase"
                >
                  {isCalculating ? "Calculando..." : "BUSCAR ITINERARIO"}
                </Button>
                
                <Dialog>
                  <DialogTrigger asChild>
                    <Button 
                      variant="outline"
                      className="w-full py-3 rounded-none bg-white text-[#4caf50] hover:bg-gray-50 border-[#4caf50] hover:border-[#3d8b40] border-2 flex items-center justify-center gap-2"
                    >
                      <Map className="h-5 w-5" />
                      <span className="text-base font-bold">TODAS LAS RUTAS</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col p-0 overflow-hidden">
                    <DialogHeader className="p-4 border-b bg-green-50">
                      <DialogTitle className="text-xl font-bold text-center text-green-800">Todas las Rutas de Xalapa</DialogTitle>
                      
                      <div className="relative mt-3">
                        <Input 
                          type="text" 
                          placeholder="Buscar ruta por número o nombre..." 
                          className="pl-10 pr-4 py-2 border-green-200 focus:border-green-400 focus:ring-green-400"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <SearchIcon className="h-5 w-5 absolute left-3 top-3 text-green-500" />
                      </div>
                      
                      {/* Filtro por zonas */}
                      <div className="mt-3">
                        <div className="flex flex-wrap gap-2 justify-center">
                          <Button 
                            variant={selectedZone === 'all' ? 'default' : 'outline'} 
                            className={`px-3 py-1 h-8 text-sm rounded-full ${selectedZone === 'all' ? 'bg-green-600 hover:bg-green-700' : 'border-green-300 text-green-700 hover:bg-green-50'}`}
                            onClick={() => setSelectedZone('all')}
                          >
                            Todas
                          </Button>
                          
                          {zones.map(zone => (
                            <Button 
                              key={zone.value} 
                              variant={selectedZone === zone.value ? 'default' : 'outline'} 
                              className={`px-3 py-1 h-8 text-sm rounded-full ${selectedZone === zone.value ? 'bg-green-600 hover:bg-green-700' : 'border-green-300 text-green-700 hover:bg-green-50'}`}
                              onClick={() => setSelectedZone(zone.value)}
                            >
                              {zone.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </DialogHeader>
                    
                    {/* Lista de rutas */}
                    <div className="overflow-y-auto flex-grow p-4 space-y-2 max-h-[60vh]">
                      {routesLoading ? (
                        // Skeleton loaders
                        Array.from({ length: 6 }).map((_, i) => (
                          <div key={i} className="p-3 rounded-lg border border-gray-200 flex items-center space-x-3">
                            <Skeleton className="w-10 h-10 rounded-full" />
                            <div className="space-y-2 flex-1">
                              <Skeleton className="h-4 w-4/5" />
                              <Skeleton className="h-3 w-3/5" />
                            </div>
                          </div>
                        ))
                      ) : (
                        filteredAndSortedRoutes.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {filteredAndSortedRoutes.map(route => (
                              <div 
                                key={route.id} 
                                className={`p-3 rounded-lg border border-gray-200 hover:bg-gray-50
                                          cursor-pointer flex items-center space-x-3 transition-colors`}
                                onClick={() => {
                                  // Agregar lógica para mostrar la ruta en el mapa
                                  console.log("Ruta seleccionada:", route.id);
                                }}
                              >
                                <div 
                                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow-sm"
                                  style={{ backgroundColor: route.color }}
                                >
                                  {route.shortName}
                                </div>
                                <div>
                                  <h3 className="font-medium">{route.name}</h3>
                                  <p className="text-sm text-gray-500">Cada {route.frequency} · {route.stopsCount} paradas</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-8 text-center">
                            <SearchIcon className="h-10 w-10 text-gray-300 mb-2" />
                            <p className="text-gray-500">No se encontraron rutas que coincidan con tu búsqueda.</p>
                          </div>
                        )
                      )}
                    </div>
                    
                    <div className="p-4 border-t bg-green-50 text-xs text-green-700 text-center">
                      Selecciona una ruta para ver su trayecto en el mapa
                    </div>
                  </DialogContent>
                </Dialog>
              </CardFooter>
            </Card>

            {routeResults && (
              <Card className="mt-4 orizo-card-shadow border-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-bold text-center text-[#4caf50]">Itinerarios Encontrados</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {routeResults.map((route) => (
                    <Card key={route.id} className="orizo-itinerary-card hover:border-primary cursor-pointer">
                      <CardHeader className="pb-2 pt-4">
                        <div className="flex justify-between items-center">
                          <div className="text-sm text-muted-foreground">
                            Salida: <span className="font-bold">{route.startTime}</span>
                          </div>
                          <div className="font-bold text-primary text-lg">{route.duration}</div>
                          <div className="text-sm text-muted-foreground">
                            Llegada: <span className="font-bold">{route.endTime}</span>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          {route.steps.map((step: any, index: number) => (
                            <div key={index} className="flex items-start">
                              {step.type === 'walk' ? (
                                <div className="orizo-walk-badge mr-3">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                  </svg>
                                </div>
                              ) : (
                                <div className="orizo-route-badge mr-3" style={{backgroundColor: step.routeColor || '#0056A4'}}>
                                  <span className="text-sm font-bold">{step.routeName?.split(' ')[1] || ''}</span>
                                </div>
                              )}
                              <div className="flex-1">
                                <div className="text-sm">
                                  {step.type === 'walk' ? (
                                    `Caminar ${step.distance}`
                                  ) : (
                                    <>
                                      <span className="font-bold">{step.routeName}</span>
                                      <div className="text-xs text-muted-foreground mt-1">
                                        De {step.from.stopName} a {step.to.stopName}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="text-sm font-medium">{step.duration}</div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Mapa */}
        <div className="col-span-1 lg:col-span-2">
          <Card className="h-[calc(100vh-2rem)] orizo-card-shadow border-0 overflow-hidden">
            <CardContent className="p-0 h-full w-full">
              <RouteMapView 
                routes={routes || []} 
                selectedRoutes={routeResults ? routeResults.flatMap(route => 
                  route.steps
                    .filter((step: any) => step.type === 'bus')
                    .map((step: any) => {
                      // Encontrar el ID de la ruta basado en el nombre de la ruta
                      const routeInfo = routes?.find(r => r.name === step.routeName);
                      return routeInfo?.id || 0;
                    })
                    .filter((id: number) => id !== 0)
                ) : []}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default RoutePlanner;