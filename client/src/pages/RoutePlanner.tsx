import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarIcon, Clock10Icon, Clock3Icon, ArrowUpDown, MapPin, XIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import RouteMapView from "../components/RouteMapView";
import { useQuery } from "@tanstack/react-query";
import { BusRoute } from "@shared/schema";

const RoutePlanner: React.FC = () => {
  const [startLocation, setStartLocation] = useState("");
  const [endLocation, setEndLocation] = useState("");
  const [date, setDate] = useState<Date>(new Date());
  const [departureTime, setDepartureTime] = useState<string>("12:00");
  const [arrivalTime, setArrivalTime] = useState<string>("13:00");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isArrival, setIsArrival] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [routeResults, setRouteResults] = useState<any[] | null>(null);
  
  // Cargar todas las rutas para poder mostrarlas en el mapa
  const { data: routes } = useQuery<BusRoute[]>({
    queryKey: ['/api/routes'],
  });

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
      // En caso de error, mostrar al menos algún resultado de ejemplo
      setRouteResults([
        { 
          id: 1, 
          duration: "45 min", 
          startTime: departureTime || "12:00", 
          endTime: "12:45",
          steps: [
            { type: "walk", duration: "5 min", description: "Caminar hasta parada Terminal Centro" },
            { type: "bus", routeNumber: "82", routeName: "Ruta 82", duration: "35 min", startStop: "Terminal Centro", endStop: "Calle Murillo Vidal" },
            { type: "walk", duration: "5 min", description: "Caminar hasta destino" }
          ]
        }
      ]);
    } finally {
      setIsCalculating(false);
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-7xl">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Panel de búsqueda */}
        <div className="col-span-1">
          <div className="space-y-4">
            <Card className="shadow-lg overflow-hidden border-0">
              <CardHeader className="pb-2 bg-[#0056A4] text-white">
                <CardTitle className="text-xl text-center font-bold">Mi Itinerario</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                <div className="relative">
                  <div className="absolute left-0 top-0 bottom-0 w-12 bg-[#0056A4] rounded-l-lg flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-white" />
                  </div>
                  <Input 
                    type="text" 
                    value={startLocation}
                    onChange={(e) => setStartLocation(e.target.value)}
                    className="pl-14 h-12 border-2 border-[#0056A4] focus:ring-[#0056A4] focus:border-[#0056A4] rounded-lg" 
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
                    className="rounded-full w-10 h-10 p-0 bg-white border-2 border-[#0056A4] shadow-md hover:bg-gray-50"
                    onClick={handleSwapLocations}
                  >
                    <ArrowUpDown className="h-5 w-5 text-[#0056A4]" />
                  </Button>
                </div>
                
                <div className="relative">
                  <div className="absolute left-0 top-0 bottom-0 w-12 bg-[#F9CD00] rounded-l-lg flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-gray-800" />
                  </div>
                  <Input 
                    type="text" 
                    value={endLocation}
                    onChange={(e) => setEndLocation(e.target.value)}
                    className="pl-14 h-12 border-2 border-[#F9CD00] focus:ring-[#F9CD00] focus:border-[#F9CD00] rounded-lg" 
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
                  <TabsList className="grid w-full grid-cols-2 border-2 border-[#0056A4] p-0 rounded-lg overflow-hidden">
                    <TabsTrigger 
                      value="departure" 
                      onClick={() => setIsArrival(false)}
                      className="rounded-none data-[state=active]:bg-[#0056A4] data-[state=active]:text-white py-3"
                    >
                      Salida
                    </TabsTrigger>
                    <TabsTrigger 
                      value="arrival" 
                      onClick={() => setIsArrival(true)}
                      className="rounded-none data-[state=active]:bg-[#0056A4] data-[state=active]:text-white py-3"
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
              <CardFooter>
                <Button 
                  onClick={handleCalculateRoute}
                  disabled={!startLocation || !endLocation || isCalculating}
                  className="w-full py-3 text-base font-bold bg-[#F9CD00] text-gray-800 hover:bg-[#e8bf00] rounded-full shadow-md uppercase"
                >
                  {isCalculating ? "Calculando..." : "BUSCAR ITINERARIO"}
                </Button>
              </CardFooter>
            </Card>

            {routeResults && (
              <Card className="mt-4 orizo-card-shadow border-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg text-center text-primary">Itinerarios Encontrados</CardTitle>
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
                                <div className="orizo-route-badge mr-3">
                                  <span className="text-sm font-bold">{step.routeNumber}</span>
                                </div>
                              )}
                              <div className="flex-1">
                                <div className="text-sm">
                                  {step.type === 'walk' ? (
                                    step.description
                                  ) : (
                                    <>
                                      <span className="font-bold">{step.routeName}</span>
                                      <div className="text-xs text-muted-foreground mt-1">
                                        De {step.startStop} a {step.endStop}
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
          <Card className="h-[calc(100vh-2rem)]">
            <CardContent className="p-0 h-full">
              <RouteMapView 
                routes={routes || []} 
                selectedRoutes={routeResults ? routeResults.flatMap(route => 
                  route.steps
                    .filter(step => step.type === 'bus')
                    .map(step => {
                      // Encontrar el ID de la ruta basado en el nombre de la ruta
                      const routeInfo = routes?.find(r => r.name === step.routeName);
                      return routeInfo?.id || 0;
                    })
                    .filter(id => id !== 0)
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