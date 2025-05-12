import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BusRoute } from '@shared/schema';

interface RouteMapEditorProps {
  route?: BusRoute;
  onGeometryChange: (coordinates: [number, number][]) => void;
  readOnly?: boolean;
}

export default function SimpleRouteMapEditor({ route, onGeometryChange, readOnly = false }: RouteMapEditorProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
  const [markers, setMarkers] = useState<L.Marker[]>([]);
  const [polyline, setPolyline] = useState<L.Polyline | null>(null);
  const [editingPoint, setEditingPoint] = useState<number | null>(null);

  // Inicializar el mapa
  useEffect(() => {
    if (!mapRef.current || mapInstance) return;

    // Crear el mapa
    const map = L.map(mapRef.current, {
      center: [19.5438, -96.9102], // Coordenadas de Xalapa
      zoom: 13,
      zoomControl: true,
    });

    // Agregar capa base de OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Guardar la instancia del mapa
    setMapInstance(map);

    // Limpiar al desmontar
    return () => {
      map.remove();
    };
  }, [mapRef, mapInstance]);

  // Cargar la ruta cuando cambie la prop route
  useEffect(() => {
    if (!mapInstance || !route?.geoJSON) return;

    try {
      // Limpiar marcadores y polyline anteriores
      markers.forEach(marker => marker.remove());
      if (polyline) polyline.remove();
      setMarkers([]);
      
      // Parsear el GeoJSON si es necesario
      let geoJsonData: any = route.geoJSON;
      if (typeof geoJsonData === 'string') {
        geoJsonData = JSON.parse(geoJsonData);
      }

      // Extraer las coordenadas del GeoJSON
      let extractedCoordinates: [number, number][] = [];
      
      if (geoJsonData && typeof geoJsonData === 'object') {
        if (geoJsonData.type === 'FeatureCollection' && geoJsonData.features && geoJsonData.features.length > 0) {
          // Es una colección de características
          extractedCoordinates = geoJsonData.features[0].geometry.coordinates;
        } else if (geoJsonData.type === 'Feature' && geoJsonData.geometry) {
          // Es una característica individual
          extractedCoordinates = geoJsonData.geometry.coordinates;
        } else if (geoJsonData.coordinates && Array.isArray(geoJsonData.coordinates)) {
          // Es un objeto de geometría directo
          extractedCoordinates = geoJsonData.coordinates;
        }
      }
      
      setRouteCoordinates(extractedCoordinates);

      // Crear polyline
      const routePolyline = L.polyline(
        extractedCoordinates.map(coord => [coord[1], coord[0]]),
        { color: route.color || '#3388ff', weight: 5 }
      ).addTo(mapInstance);
      
      setPolyline(routePolyline);
      
      // Ajustar el mapa para mostrar toda la ruta
      mapInstance.fitBounds(routePolyline.getBounds(), { padding: [50, 50] });

      // Si no es de solo lectura, crear marcadores para cada punto
      if (!readOnly) {
        // Crear marcadores para cada punto
        const newMarkers = extractedCoordinates.map((coord, index) => {
          const marker = L.marker([coord[1], coord[0]], {
            draggable: true,
            title: `Punto ${index + 1}`,
            icon: L.divIcon({
              className: 'custom-div-icon',
              html: `<div style="background-color:${route.color || '#3388ff'}; width:10px; height:10px; border-radius:50%"></div>`,
              iconSize: [10, 10],
              iconAnchor: [5, 5]
            })
          }).addTo(mapInstance);
          
          // Evento al arrastrar el punto
          marker.on('dragend', (e) => {
            const latlng = (e.target as L.Marker).getLatLng();
            updateCoordinate(index, [latlng.lng, latlng.lat]);
          });
          
          return marker;
        });
        
        setMarkers(newMarkers);
      }
    } catch (error) {
      console.error('Error al cargar la geometría de la ruta:', error);
    }
  }, [mapInstance, route, readOnly]);

  // Actualizar una coordenada específica
  const updateCoordinate = (index: number, newCoord: [number, number]) => {
    const updatedCoordinates = [...routeCoordinates];
    updatedCoordinates[index] = newCoord;
    setRouteCoordinates(updatedCoordinates);
    
    // Actualizar polyline
    if (polyline && mapInstance) {
      polyline.setLatLngs(updatedCoordinates.map(coord => [coord[1], coord[0]]));
      
      // Notificar cambio
      onGeometryChange(updatedCoordinates);
    }
  };

  // Función para agregar un punto entre dos puntos existentes
  const addPointBetween = (index: number) => {
    if (index < 0 || index >= routeCoordinates.length - 1 || !mapInstance) return;
    
    // Calcular punto medio
    const coord1 = routeCoordinates[index];
    const coord2 = routeCoordinates[index + 1];
    const midLng = (coord1[0] + coord2[0]) / 2;
    const midLat = (coord1[1] + coord2[1]) / 2;
    
    // Insertar nuevo punto
    const newCoordinates = [...routeCoordinates];
    newCoordinates.splice(index + 1, 0, [midLng, midLat]);
    setRouteCoordinates(newCoordinates);
    
    // Actualizar polyline
    if (polyline) {
      polyline.setLatLngs(newCoordinates.map(coord => [coord[1], coord[0]]));
    }
    
    // Crear nuevo marcador
    const newMarker = L.marker([midLat, midLng], {
      draggable: true,
      title: `Punto ${index + 2}`,
      icon: L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color:${route?.color || '#3388ff'}; width:10px; height:10px; border-radius:50%"></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5]
      })
    }).addTo(mapInstance);
    
    // Evento al arrastrar el punto
    newMarker.on('dragend', (e) => {
      const latlng = (e.target as L.Marker).getLatLng();
      updateCoordinate(index + 1, [latlng.lng, latlng.lat]);
    });
    
    // Actualizar array de marcadores
    const newMarkers = [...markers];
    newMarkers.splice(index + 1, 0, newMarker);
    setMarkers(newMarkers);
    
    // Notificar cambio
    onGeometryChange(newCoordinates);
  };

  // Función para eliminar un punto
  const removePoint = (index: number) => {
    if (index < 0 || index >= routeCoordinates.length || routeCoordinates.length <= 2) return;
    
    // Eliminar punto
    const newCoordinates = [...routeCoordinates];
    newCoordinates.splice(index, 1);
    setRouteCoordinates(newCoordinates);
    
    // Actualizar polyline
    if (polyline) {
      polyline.setLatLngs(newCoordinates.map(coord => [coord[1], coord[0]]));
    }
    
    // Eliminar marcador
    if (markers[index]) {
      markers[index].remove();
      const newMarkers = [...markers];
      newMarkers.splice(index, 1);
      setMarkers(newMarkers);
    }
    
    // Notificar cambio
    onGeometryChange(newCoordinates);
  };

  return (
    <div className="route-editor-container">
      <div 
        ref={mapRef} 
        className="w-full h-[500px] rounded-md border border-gray-300 mt-2"
        style={{ display: 'block' }}
      />
      
      {!readOnly && (
        <div className="mt-4 flex gap-2 flex-wrap">
          <h3 className="w-full text-lg font-semibold">Herramientas de edición:</h3>
          <div className="bg-white shadow-sm p-4 rounded-md w-full">
            <div className="flex flex-col gap-2">
              <p>Total de puntos: {routeCoordinates.length}</p>
              <div className="flex gap-2">
                <button 
                  className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600" 
                  onClick={() => {
                    // Agregar punto al final
                    if (routeCoordinates.length >= 2) {
                      addPointBetween(routeCoordinates.length - 2);
                    }
                  }}
                >
                  Agregar punto al final
                </button>
                <button 
                  className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600" 
                  onClick={() => {
                    // Agregar punto al inicio
                    if (routeCoordinates.length >= 2) {
                      addPointBetween(0);
                    }
                  }}
                >
                  Agregar punto al inicio
                </button>
              </div>
              
              <p className="mt-2 text-sm text-gray-600">
                Haz clic en un marcador y arrástralo para ajustar la ruta. Para agregar puntos intermedios, 
                selecciona un punto existente y haz clic en "Agregar punto después".
              </p>
              
              {editingPoint !== null && (
                <div className="bg-gray-100 p-3 rounded mt-2">
                  <p>Editando punto {editingPoint + 1}</p>
                  <div className="flex gap-2 mt-2">
                    <button 
                      className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600" 
                      onClick={() => {
                        addPointBetween(editingPoint);
                        setEditingPoint(null);
                      }}
                    >
                      Agregar punto después
                    </button>
                    <button 
                      className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600" 
                      onClick={() => {
                        removePoint(editingPoint);
                        setEditingPoint(null);
                      }}
                    >
                      Eliminar punto
                    </button>
                    <button 
                      className="bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600" 
                      onClick={() => setEditingPoint(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}