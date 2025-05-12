import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BusRoute } from '@shared/schema';
import Header from '@/components/Header';
import SimpleRouteMapEditor from '@/components/SimpleRouteMapEditor';

export default function RouteEditor() {
  const [, setLocation] = useLocation();
  const [routeId, setRouteId] = useState<number | null>(null);
  const [routeData, setRouteData] = useState<Partial<BusRoute>>({});
  const [geoJsonText, setGeoJsonText] = useState<string>('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Buscar los datos de la ruta si hay un ID
  const { data: route, refetch } = useQuery<BusRoute>({
    queryKey: ['/api/routes', routeId],
    queryFn: async () => {
      if (!routeId) return null as any;
      const response = await fetch(`/api/routes/${routeId}`);
      if (!response.ok) {
        throw new Error('Error al cargar la ruta');
      }
      return response.json();
    },
    enabled: !!routeId,
  });

  // Al obtener la ruta, actualizar el estado local
  useEffect(() => {
    if (route) {
      setRouteData({
        name: route.name,
        shortName: route.shortName,
        zone: route.zone,
        stopsCount: route.stopsCount,
        color: route.color,
        frequency: route.frequency,
        scheduleStart: route.scheduleStart,
        scheduleEnd: route.scheduleEnd,
        approximateTime: route.approximateTime,
        popular: route.popular,
      });
      
      // Formatear el GeoJSON para mostrar
      const geoJson = route.geoJSON;
      try {
        setGeoJsonText(JSON.stringify(geoJson, null, 2));
      } catch (error) {
        setGeoJsonText(String(geoJson));
      }
    }
  }, [route]);

  // Manejar cambios en los campos
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setRouteData({ ...routeData, [name]: checked });
    } else if (type === 'number') {
      setRouteData({ ...routeData, [name]: parseInt(value, 10) });
    } else {
      setRouteData({ ...routeData, [name]: value });
    }
  };

  // Manejar cambios en el GeoJSON
  const handleGeoJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setGeoJsonText(e.target.value);
  };

  // Buscar la ruta
  const handleSearch = () => {
    if (routeId) {
      refetch();
    }
  };

  // Guardar los cambios
  const handleSave = async () => {
    if (!routeId) {
      setMessage({ type: 'error', text: 'ID de ruta no válido' });
      return;
    }

    try {
      setLoading(true);
      setMessage(null);

      // Preparar los datos a enviar
      const dataToSend: any = { ...routeData };
      
      // Si se modificó el GeoJSON, intentamos parsearlo
      if (geoJsonText.trim()) {
        try {
          dataToSend.geoJSON = JSON.parse(geoJsonText);
        } catch (error) {
          setMessage({ type: 'error', text: 'El formato del GeoJSON no es válido' });
          setLoading(false);
          return;
        }
      }

      // Enviar la actualización
      const response = await fetch(`/api/routes/${routeId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataToSend),
      });

      if (!response.ok) {
        throw new Error('Error al actualizar la ruta');
      }

      // Actualizar la interfaz con la respuesta
      const updatedRoute = await response.json();
      setRouteData({
        name: updatedRoute.name,
        shortName: updatedRoute.shortName,
        zone: updatedRoute.zone,
        stopsCount: updatedRoute.stopsCount,
        color: updatedRoute.color,
        frequency: updatedRoute.frequency,
        scheduleStart: updatedRoute.scheduleStart,
        scheduleEnd: updatedRoute.scheduleEnd,
        approximateTime: updatedRoute.approximateTime,
        popular: updatedRoute.popular,
      });
      
      // Formatear el GeoJSON actualizado
      setGeoJsonText(JSON.stringify(updatedRoute.geoJSON, null, 2));
      
      setMessage({ type: 'success', text: 'Ruta actualizada correctamente' });
    } catch (error) {
      console.error('Error al guardar:', error);
      setMessage({ type: 'error', text: 'Error al guardar los cambios: ' + (error as Error).message });
    } finally {
      setLoading(false);
    }
  };

  // Función para manejar cambios en la geometría (coordenadas)
  const handleGeometryChange = (newCoordinates: [number, number][]) => {
    try {
      // Obtener el GeoJSON actual
      let geoJson = geoJsonText ? JSON.parse(geoJsonText) : null;
      
      if (!geoJson) return;
      
      // Actualizar las coordenadas en el GeoJSON
      if (geoJson.type === 'FeatureCollection' && geoJson.features && geoJson.features.length > 0) {
        geoJson.features[0].geometry.coordinates = newCoordinates;
      } else if (geoJson.type === 'Feature') {
        geoJson.geometry.coordinates = newCoordinates;
      } else if (geoJson.coordinates) {
        geoJson.coordinates = newCoordinates;
      }
      
      // Actualizar el estado
      setGeoJsonText(JSON.stringify(geoJson, null, 2));
    } catch (error) {
      console.error('Error al actualizar la geometría:', error);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Header />
      
      <div className="container mx-auto py-8 px-4">
        <div className="mb-8 flex justify-between items-center">
          <h1 className="text-3xl font-bold">Editor de Rutas</h1>
          <Button onClick={() => setLocation('/')} variant="outline">
            Volver al Mapa
          </Button>
        </div>
        
        {message && (
          <Alert className={`mb-6 ${message.type === 'success' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <AlertTitle>{message.type === 'success' ? 'Éxito' : 'Error'}</AlertTitle>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
        
        {/* Buscador de rutas */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Buscar Ruta</CardTitle>
            <CardDescription>Ingresa el ID de la ruta a editar</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="ID de la ruta"
                value={routeId || ''}
                onChange={(e) => setRouteId(parseInt(e.target.value) || null)}
              />
              <Button onClick={handleSearch}>Buscar</Button>
            </div>
          </CardContent>
        </Card>
        
        {route && (
          <Tabs defaultValue="visual" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="visual">Editor Visual</TabsTrigger>
              <TabsTrigger value="info">Información</TabsTrigger>
              <TabsTrigger value="geojson">GeoJSON Avanzado</TabsTrigger>
            </TabsList>
            
            <TabsContent value="visual">
              <Card>
                <CardHeader>
                  <CardTitle>Editor Visual de Ruta</CardTitle>
                  <CardDescription>
                    Arrastra los marcadores para ajustar la ruta o agrega nuevos puntos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SimpleRouteMapEditor
                    route={route}
                    onGeometryChange={handleGeometryChange}
                  />
                </CardContent>
                <CardFooter className="flex justify-end gap-2">
                  <Button
                    onClick={() => refetch()}
                    variant="outline"
                    disabled={loading}
                  >
                    Descartar Cambios
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={loading}
                  >
                    {loading ? 'Guardando...' : 'Guardar Cambios'}
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>
            
            <TabsContent value="info">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Información básica */}
                <Card>
                  <CardHeader>
                    <CardTitle>Información Básica</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="name">Nombre</Label>
                        <Input
                          id="name"
                          name="name"
                          value={routeData.name || ''}
                          onChange={handleChange}
                        />
                      </div>
                      <div>
                        <Label htmlFor="shortName">Nombre Corto</Label>
                        <Input
                          id="shortName"
                          name="shortName"
                          value={routeData.shortName || ''}
                          onChange={handleChange}
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="zone">Zona</Label>
                        <select
                          id="zone"
                          name="zone"
                          className="w-full rounded-md border border-gray-300 p-2"
                          value={routeData.zone || ''}
                          onChange={handleChange}
                        >
                          <option value="">Seleccionar...</option>
                          <option value="norte">Norte</option>
                          <option value="sur">Sur</option>
                          <option value="este">Este</option>
                          <option value="oeste">Oeste</option>
                          <option value="centro">Centro</option>
                        </select>
                      </div>
                      <div>
                        <Label htmlFor="stopsCount">Cantidad de Paradas</Label>
                        <Input
                          id="stopsCount"
                          name="stopsCount"
                          type="number"
                          value={routeData.stopsCount || 0}
                          onChange={handleChange}
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="color">Color</Label>
                        <div className="flex gap-2">
                          <Input
                            id="color"
                            name="color"
                            value={routeData.color || ''}
                            onChange={handleChange}
                          />
                          <div 
                            className="w-10 h-10 rounded border"
                            style={{ backgroundColor: routeData.color || '#FFFFFF' }}
                          ></div>
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="frequency">Frecuencia</Label>
                        <Input
                          id="frequency"
                          name="frequency"
                          value={routeData.frequency || ''}
                          onChange={handleChange}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                {/* Horarios */}
                <Card>
                  <CardHeader>
                    <CardTitle>Horarios y Tiempos</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="scheduleStart">Hora de Inicio</Label>
                        <Input
                          id="scheduleStart"
                          name="scheduleStart"
                          value={routeData.scheduleStart || ''}
                          onChange={handleChange}
                        />
                      </div>
                      <div>
                        <Label htmlFor="scheduleEnd">Hora de Fin</Label>
                        <Input
                          id="scheduleEnd"
                          name="scheduleEnd"
                          value={routeData.scheduleEnd || ''}
                          onChange={handleChange}
                        />
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="approximateTime">Tiempo Aproximado</Label>
                      <Input
                        id="approximateTime"
                        name="approximateTime"
                        value={routeData.approximateTime || ''}
                        onChange={handleChange}
                      />
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="popular"
                        name="popular"
                        checked={routeData.popular || false}
                        onChange={(e) => setRouteData({ ...routeData, popular: e.target.checked })}
                      />
                      <Label htmlFor="popular">Ruta Popular</Label>
                    </div>
                  </CardContent>
                </Card>
                
                {/* Botones para guardar la información */}
                <Card className="col-span-2">
                  <CardContent className="pt-6">
                    <div className="flex justify-end gap-2">
                      <Button
                        onClick={() => refetch()}
                        variant="outline"
                        disabled={loading}
                      >
                        Descartar Cambios
                      </Button>
                      <Button
                        onClick={handleSave}
                        disabled={loading}
                      >
                        {loading ? 'Guardando...' : 'Guardar Cambios'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            
            <TabsContent value="geojson">
              {/* GeoJSON Avanzado */}
              <Card>
                <CardHeader>
                  <CardTitle>Datos GeoJSON</CardTitle>
                  <CardDescription>Editor avanzado para modificar directamente el GeoJSON</CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={geoJsonText}
                    onChange={handleGeoJsonChange}
                    rows={15}
                    className="font-mono text-sm"
                  />
                </CardContent>
                <CardFooter className="flex justify-end gap-2">
                  <Button
                    onClick={() => refetch()}
                    variant="outline"
                    disabled={loading}
                  >
                    Descartar Cambios
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={loading}
                  >
                    {loading ? 'Guardando...' : 'Guardar Cambios'}
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}