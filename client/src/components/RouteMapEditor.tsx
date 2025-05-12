import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BusRoute } from '@shared/schema';

// Importamos leaflet-draw de forma dinámica para evitar problemas de tipos
let LeafletDraw: any = null;

interface RouteMapEditorProps {
  route?: BusRoute;
  onGeometryChange: (coordinates: [number, number][]) => void;
  readOnly?: boolean;
}

export default function RouteMapEditor({ route, onGeometryChange, readOnly = false }: RouteMapEditorProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [editLayer, setEditLayer] = useState<L.Polyline | null>(null);
  const [drawControl, setDrawControl] = useState<any | null>(null);
  
  // Cargar Leaflet Draw dinámicamente
  useEffect(() => {
    async function loadLeafletDraw() {
      if (!LeafletDraw) {
        await import('leaflet-draw/dist/leaflet.draw.css');
        await import('leaflet-draw');
        LeafletDraw = true; // Marcamos que se ha cargado
      }
    }
    
    loadLeafletDraw();
  }, []);

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

    // Limpiar capas anteriores
    if (editLayer) {
      mapInstance.removeLayer(editLayer);
    }
    if (drawControl) {
      mapInstance.removeControl(drawControl);
    }

    try {
      // Parsear el GeoJSON si es necesario
      const geometry = typeof route.geoJSON === 'string' 
        ? JSON.parse(route.geoJSON) 
        : route.geoJSON;

      // Verificar si es una colección de características o una característica directa
      let coordinates: [number, number][] = [];
      
      if (geometry.type === 'FeatureCollection') {
        // Es una colección, extraer coordenadas de la primera característica
        if (geometry.features && geometry.features.length > 0) {
          coordinates = geometry.features[0].geometry.coordinates;
        }
      } else if (geometry.type === 'Feature') {
        // Es una característica directa
        coordinates = geometry.geometry.coordinates;
      } else if (geometry.coordinates) {
        // Es un objeto de geometría directo
        coordinates = geometry.coordinates;
      }

      // Crear la capa de edición (polyline)
      const polyline = L.polyline(coordinates.map(coord => [coord[1], coord[0]]), {
        color: route.color || '#3388ff',
        weight: 5,
        opacity: 0.7
      }).addTo(mapInstance);
      
      // Ajustar el mapa para mostrar toda la ruta
      mapInstance.fitBounds(polyline.getBounds(), {
        padding: [50, 50]
      });
      
      setEditLayer(polyline);

      // Si no es de solo lectura, agregar controles de edición
      if (!readOnly) {
        // Configurar opciones de edición
        const drawOptions = {
          polyline: false,
          polygon: false, 
          circle: false,
          rectangle: false,
          marker: false,
          circlemarker: false,
          edit: {
            featureGroup: L.featureGroup([polyline]),
            remove: false,
            poly: {
              allowIntersection: false
            }
          }
        };

        // Crear el control de dibujo
        const control = new L.Control.Draw(drawOptions);
        control.addTo(mapInstance);
        setDrawControl(control);

        // Configurar eventos para edición
        mapInstance.on(L.Draw.Event.EDITED, (e) => {
          const layers = (e as any).layers;
          layers.eachLayer((layer: L.Polyline) => {
            const latlngs = layer.getLatLngs();
            // Convertir de LatLng a [lng, lat] (GeoJSON usa [lng, lat])
            const coordinates = (Array.isArray(latlngs[0]) ? latlngs[0] : latlngs)
              .map((point: any) => [point.lng, point.lat] as [number, number]);
            onGeometryChange(coordinates);
          });
        });
      }
    } catch (error) {
      console.error('Error al cargar la geometría de la ruta:', error);
    }
  }, [mapInstance, route, readOnly, onGeometryChange]);

  return (
    <div 
      ref={mapRef} 
      className="w-full h-[500px] rounded-md border border-gray-300 mt-2"
      style={{ display: 'block' }}
    />
  );
}