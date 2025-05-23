import { useEffect, useRef, useState } from 'react';
import { Plus, Minus, MapPin, Navigation, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BusRoute, BusStop } from '@shared/schema';
import { initializeMap, addBusStops } from '@/lib/mapUtils';
import { XALAPA_CENTER, DEFAULT_ZOOM } from '@/lib/constants';
import L from 'leaflet';

type RouteMapViewProps = {
  routes: BusRoute[];
  selectedRoutes?: number[];
  walkingPoints?: {
    startPoint: [number, number];
    endPoint: [number, number];
  };
  showStops?: boolean;
};

// Función auxiliar para dibujar una sola ruta
function drawSingleRoute(
  map: L.Map,
  route: BusRoute,
  isSelected: boolean,
  onRouteClick?: (routeId: number) => void
): {routeLine: L.Polyline, routeOutline: L.Polyline, shadowLine: L.Polyline} {
  try {
    console.log(`Dibujando ruta ${route.id} en RouteMapView`);
    
    // Extraer coordenadas del GeoJSON
    let coordinates: [number, number][] = [];
    
    try {
      // Parsear el GeoJSON si es string
      let geoJSON: any;
      if (typeof route.geoJSON === 'string') {
        geoJSON = JSON.parse(route.geoJSON);
      } else {
        geoJSON = route.geoJSON;
      }
      
      if (geoJSON?.type === 'FeatureCollection' && 
          Array.isArray(geoJSON.features) && 
          geoJSON.features.length > 0) {
        
        const geometry = geoJSON.features[0].geometry;
        
        if (geometry?.type === 'LineString') {
          // Formato estándar: FeatureCollection con LineString
          coordinates = geometry.coordinates;
          console.log(`Usando coordenadas LineString desde GeoJSON para ruta ${route.id}: ${coordinates.length} puntos`);
        }
        else if (geometry?.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
          // Formato MultiLineString: array de arrays de coordenadas
          // Aplanamos el array para obtener un solo LineString
          coordinates = geometry.coordinates.flat();
          console.log(`Usando coordenadas MultiLineString desde GeoJSON para ruta ${route.id}: ${coordinates.length} puntos`);
        }
        else {
          throw new Error(`Geometría no soportada: ${geometry?.type}`);
        }
      } else {
        throw new Error("Formato GeoJSON no reconocido");
      }
    } catch (error) {
      console.warn(`Error al procesar GeoJSON para ruta ${route.id}: ${error}. Usando coordenadas por defecto`);
      
      // Coordenadas de respaldo si hay error
      coordinates = [
        [-96.9270, 19.5438],
        [-96.9265, 19.5428],
        [-96.9260, 19.5418],
        [-96.9255, 19.5408],
        [-96.9250, 19.5398],
        [-96.9245, 19.5388],
        [-96.9240, 19.5378],
        [-96.9235, 19.5368],
        [-96.9230, 19.5358],
        [-96.9225, 19.5348]
      ];
    }
    
    // Validar que hay coordenadas y que son válidas
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
      console.warn(`La ruta ${route.id} no tiene suficientes coordenadas válidas`);
      return {} as any;
    }
    
    // Usar todas las coordenadas originales sin simplificar
    let simplifiedCoords = coordinates;
    
    // Convertir coordenadas a formato Leaflet [lat, lng]
    // GeoJSON usa [lon, lat] pero Leaflet usa [lat, lon]
    const leafletCoords = simplifiedCoords.map(coord => {
      if (Array.isArray(coord) && coord.length >= 2 && 
          typeof coord[0] === 'number' && typeof coord[1] === 'number') {
        return [coord[1], coord[0]] as [number, number];
      } else {
        console.warn(`Coordenada inválida encontrada:`, coord);
        return [0, 0] as [number, number]; // Valor por defecto en caso de error
      }
    }).filter(coord => coord[0] !== 0 && coord[1] !== 0); // Filtrar coordenadas inválidas
    
    // Estilos según orizo.fr - líneas más delgadas sin bordes excesivos
    // Rutas delgadas (4px) sin bordes como se solicitó
    const shadowWeight = isSelected ? 6 : 5;
    const outlineWeight = isSelected ? 5 : 4;
    const routeWeight = isSelected ? 4 : 3;
    const shadowOpacity = isSelected ? 0.2 : 0.1;
    const outlineOpacity = isSelected ? 0.7 : 0.6;
    const routeOpacity = 1.0;
    const routeClassName = isSelected ? 'route-line selected' : 'route-line';
    
    // 1. Dibujar la sombra (capa inferior)
    const shadowLine = L.polyline(leafletCoords, {
      color: 'rgba(0,0,0,0.5)',
      weight: shadowWeight,
      opacity: shadowOpacity,
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: 2.0,
      className: 'route-shadow',
      interactive: false,
      renderer: new L.SVG({ padding: 0 })
    });
    
    // 2. Dibujar el borde blanco (capa intermedia)
    const routeOutline = L.polyline(leafletCoords, {
      color: 'white',
      weight: outlineWeight,
      opacity: outlineOpacity,
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: 2.0,
      className: 'route-outline',
      interactive: false,
      renderer: new L.SVG({ padding: 0 })
    });
    
    // 3. Dibujar la línea de la ruta (capa superior)
    const routeLine = L.polyline(leafletCoords, {
      color: route.color || '#3388ff',
      weight: routeWeight,
      opacity: routeOpacity,
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: 2.0,
      className: routeClassName,
      interactive: true,
      renderer: new L.SVG({ padding: 0 })
    });
    
    // Agregar eventos solo a la línea principal si se proporciona una función de click
    if (onRouteClick) {
      routeLine.on('click', () => {
        onRouteClick(route.id);
      });
    }
    
    return { routeLine, routeOutline, shadowLine };
  } catch (error) {
    console.error(`Error al dibujar la ruta ${route.id}:`, error);
    return {} as any;
  }
}

// Función para dibujar puntos de caminata (inicio y fin)
function drawWalkingPoints(
  map: L.Map, 
  startPoint: [number, number], 
  endPoint: [number, number]
) {
  // Icono para el punto de inicio (verde)
  const startIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: #4caf50; width: 15px; height: 15px; 
           border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [15, 15],
    iconAnchor: [7, 7]
  });
  
  // Icono para el punto final (rojo)
  const endIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: #f44336; width: 15px; height: 15px; 
           border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [15, 15],
    iconAnchor: [7, 7]
  });
  
  // Crear marcadores
  const startMarker = L.marker(startPoint, { icon: startIcon }).addTo(map);
  const endMarker = L.marker(endPoint, { icon: endIcon }).addTo(map);
  
  // Línea de caminata punteada
  const walkingPath = L.polyline([startPoint, endPoint], {
    color: '#4caf50',
    weight: 3,
    opacity: 0.7,
    dashArray: '5, 7',
  }).addTo(map);
  
  return { startMarker, endMarker, walkingPath };
}

export default function RouteMapView({ 
  routes, 
  selectedRoutes = [],
  walkingPoints,
  showStops = true
}: RouteMapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const routeLayersRef = useRef<Map<number, {routeLine: L.Polyline, routeOutline: L.Polyline, shadowLine: L.Polyline}>>(new Map());
  const stopMarkersRef = useRef<L.Marker[]>([]);
  const walkingMarkersRef = useRef<{startMarker?: L.Marker, endMarker?: L.Marker, walkingPath?: L.Polyline}>({});
  
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
  
  // Efecto para cargar las paradas de las rutas seleccionadas
  const [routeStops, setRouteStops] = useState<Map<number, any[]>>(new Map());
  
  useEffect(() => {
    // Cargar las paradas de las rutas seleccionadas cuando cambian
    if (selectedRoutes.length > 0) {
      selectedRoutes.forEach(routeId => {
        if (!routeStops.has(routeId)) {
          fetch(`/api/routes/${routeId}/stops`)
            .then(response => response.json())
            .then(data => {
              setRouteStops(prev => {
                const newMap = new Map(prev);
                newMap.set(routeId, data);
                return newMap;
              });
            })
            .catch(error => {
              console.error(`Error al cargar paradas para la ruta ${routeId}:`, error);
            });
        }
      });
    }
  }, [selectedRoutes]);

  // Efecto para manejar la visualización de rutas seleccionadas
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    
    const map = mapInstanceRef.current;
    
    // Limpiar todas las rutas existentes del mapa
    routeLayersRef.current.forEach((layers, routeId) => {
      if (map.hasLayer(layers.routeLine)) {
        map.removeLayer(layers.routeLine);
        map.removeLayer(layers.routeOutline);
        map.removeLayer(layers.shadowLine);
      }
    });
    
    // Limpiar todos los marcadores de paradas existentes
    stopMarkersRef.current.forEach(marker => {
      if (map.hasLayer(marker)) {
        map.removeLayer(marker);
      }
    });
    stopMarkersRef.current = [];
    
    // Resetear las capas almacenadas
    routeLayersRef.current.clear();
    
    // Si no hay rutas seleccionadas, terminamos aquí
    if (selectedRoutes.length === 0) {
      return;
    }
    
    // Dibujar las rutas seleccionadas
    const routesToShow = routes.filter(r => selectedRoutes.includes(r.id));
    
    if (routesToShow.length > 0) {
      // Bounds para ajustar el mapa
      const bounds = L.latLngBounds([]);
      
      routesToShow.forEach(route => {
        const layers = drawSingleRoute(map, route, true);
        
        if (Object.keys(layers).length === 0) return;
        
        // Añadir las capas al mapa
        layers.shadowLine.addTo(map);
        layers.routeOutline.addTo(map);
        layers.routeLine.addTo(map);
        
        // Asegurar el orden correcto de las capas
        layers.shadowLine.bringToBack();
        layers.routeOutline.bringToFront();
        layers.routeLine.bringToFront();
        
        // Guardar referencia a las capas
        routeLayersRef.current.set(route.id, layers);
        
        // Extender los bounds para incluir esta ruta
        try {
          const routeBounds = layers.routeLine.getBounds();
          if (routeBounds && routeBounds.isValid()) {
            bounds.extend(routeBounds);
          }
        } catch (error) {
          console.error("Error al extender bounds:", error);
        }
        
        // Agregar las paradas de la ruta si tenemos datos
        if (showStops && routeStops.has(route.id)) {
          const stops = routeStops.get(route.id) || [];
          const stopsMarkers = addBusStops(map, route.id, stops, route.color);
          stopMarkersRef.current = [...stopMarkersRef.current, ...stopsMarkers];
        }
      });
      
      // Ajustar el mapa a los bounds de todas las rutas
      if (bounds.isValid()) {
        map.fitBounds(bounds, {
          padding: [50, 50],
          maxZoom: 15,
          animate: true
        });
      }
    }
  }, [mapReady, routes, selectedRoutes, routeStops, showStops]);
  
  // Efecto para dibujar puntos de caminata
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !walkingPoints) return;
    
    const map = mapInstanceRef.current;
    
    // Limpiar marcadores anteriores
    if (walkingMarkersRef.current.startMarker) {
      map.removeLayer(walkingMarkersRef.current.startMarker);
    }
    if (walkingMarkersRef.current.endMarker) {
      map.removeLayer(walkingMarkersRef.current.endMarker);
    }
    if (walkingMarkersRef.current.walkingPath) {
      map.removeLayer(walkingMarkersRef.current.walkingPath);
    }
    
    // Dibujar nuevos puntos
    const { startPoint, endPoint } = walkingPoints;
    const markers = drawWalkingPoints(map, startPoint, endPoint);
    walkingMarkersRef.current = markers;
    
  }, [mapReady, walkingPoints]);
  
  // Controles del mapa
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
    <div className="flex-grow relative h-full w-full">
      <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />
      
      {/* Map Controls */}
      <div className="absolute top-4 right-4 flex flex-col space-y-2">
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