import { useState } from 'react';
import { SearchIcon, XCircle, MapPin } from 'lucide-react';
import { BusRoute } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { zones } from '@/lib/constants';

type SidePanelProps = {
  show: boolean;
  popularRoutes: BusRoute[];
  allRoutes: BusRoute[];
  selectedZone: string;
  selectedRouteId: number | null;
  onZoneSelect: (zone: string) => void;
  onRouteSelect: (routeId: number) => void;
  onClearSelection: () => void;
  isLoading: boolean;
};

export default function SidePanel({ 
  show, 
  popularRoutes, 
  allRoutes,
  selectedZone,
  selectedRouteId,
  onZoneSelect,
  onRouteSelect,
  onClearSelection,
  isLoading 
}: SidePanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  
  const filteredRoutes = allRoutes.filter(route => 
    route.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };
  
  return (
    <div 
      className={`absolute md:relative z-10 w-full md:w-80 lg:w-96 bg-white shadow-lg 
                  transform transition-transform duration-300 
                  ${show ? 'translate-x-0' : '-translate-x-full'} 
                  md:translate-x-0 h-full flex flex-col`}
    >
      <div className="p-4 border-b">
        <div className="relative mb-2">
          <Input 
            type="text" 
            placeholder="Buscar ruta o destino..." 
            className="pl-10 pr-4 py-2"
            value={searchQuery}
            onChange={handleSearch}
          />
          <SearchIcon className="h-5 w-5 absolute left-3 top-3 text-gray-400" />
        </div>
        
        {/* Botón para borrar la selección de rutas */}
        <div className="flex justify-between items-center mt-2">
          <Button 
            onClick={onClearSelection}
            variant="outline"
            className={`px-3 py-1 text-sm gap-1 ${selectedRouteId ? 'clear-selection' : 'text-gray-400'}`}
            disabled={!selectedRouteId}
          >
            <XCircle className="h-4 w-4" />
            <span>Mostrar todas las rutas</span>
          </Button>
          
          <Button 
            variant="outline"
            className="px-3 py-1 text-sm"
            onClick={() => {}} 
          >
            <MapPin className="h-4 w-4 mr-1" />
            Mi ubicación
          </Button>
        </div>
      </div>
      
      <div className="flex-grow overflow-y-auto">
        {/* Popular Routes Section */}
        <div className="p-4 border-b">
          <h2 className="font-semibold text-lg mb-3">Rutas Populares</h2>
          <div className="space-y-2">
            {isLoading ? (
              // Skeleton loaders for popular routes
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-3 rounded-lg border border-gray-200 flex items-center space-x-3">
                  <Skeleton className="w-8 h-8 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-3 w-3/5" />
                  </div>
                </div>
              ))
            ) : (
              popularRoutes.length > 0 ? (
                popularRoutes.map(route => (
                  <div 
                    key={route.id} 
                    className={`p-3 rounded-lg border ${selectedRouteId === route.id ? 'bg-blue-50 border-blue-300' : 'border-gray-200 hover:bg-gray-50'} 
                              cursor-pointer flex items-center space-x-3`}
                    onClick={() => onRouteSelect(route.id)}
                  >
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold"
                      style={{ backgroundColor: route.color }}
                    >
                      {route.shortName}
                    </div>
                    <div>
                      <h3 className="font-medium">{route.name}</h3>
                      <p className="text-sm text-gray-500">Cada {route.frequency} · {route.stopsCount} paradas</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-sm">No hay rutas populares disponibles.</p>
              )
            )}
          </div>
        </div>
        
        {/* All Routes Section */}
        <div className="p-4 border-b">
          <h2 className="font-semibold text-lg mb-3">Todas las Rutas</h2>
          
          <div className="mb-3">
            <div className="flex flex-wrap gap-2">
              <Button 
                variant={selectedZone === 'all' ? 'default' : 'outline'} 
                className="px-3 py-1 h-8 text-sm rounded-full"
                onClick={() => onZoneSelect('all')}
              >
                Todas
              </Button>
              
              {zones.map(zone => (
                <Button 
                  key={zone.value} 
                  variant={selectedZone === zone.value ? 'default' : 'outline'} 
                  className="px-3 py-1 h-8 text-sm rounded-full"
                  onClick={() => onZoneSelect(zone.value)}
                >
                  {zone.label}
                </Button>
              ))}
            </div>
          </div>
          
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {isLoading ? (
              // Skeleton loaders for all routes
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="p-3 rounded-lg border border-gray-200 flex items-center space-x-3">
                  <Skeleton className="w-8 h-8 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-3 w-3/5" />
                  </div>
                </div>
              ))
            ) : (
              filteredRoutes.length > 0 ? (
                filteredRoutes.map(route => (
                  <div 
                    key={route.id} 
                    className={`p-3 rounded-lg border ${selectedRouteId === route.id ? 'bg-blue-50 border-blue-300' : 'border-gray-200 hover:bg-gray-50'} 
                              cursor-pointer flex items-center space-x-3`}
                    onClick={() => onRouteSelect(route.id)}
                  >
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold"
                      style={{ backgroundColor: route.color }}
                    >
                      {route.shortName}
                    </div>
                    <div>
                      <h3 className="font-medium">{route.name}</h3>
                      <p className="text-sm text-gray-500">Cada {route.frequency} · {route.stopsCount} paradas</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-sm">No se encontraron rutas que coincidan con tu búsqueda.</p>
              )
            )}
          </div>
        </div>
      </div>
      
      <div className="border-t p-4">
        <Button className="w-full py-2 bg-primary text-white rounded-lg font-medium hover:bg-blue-600 transition">
          Planifica Tu Viaje
        </Button>
      </div>
    </div>
  );
}
