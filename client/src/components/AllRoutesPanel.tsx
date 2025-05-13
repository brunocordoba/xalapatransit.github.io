import { useState } from 'react';
import { BusRoute } from '@shared/schema';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchIcon, Map } from 'lucide-react';
import { zones } from '@/lib/constants';
import { Skeleton } from '@/components/ui/skeleton';

type AllRoutesPanelProps = {
  routes: BusRoute[];
  isLoading: boolean;
  onRouteSelect: (routeId: number) => void;
  selectedRouteId: number | null;
};

export default function AllRoutesPanel({
  routes,
  isLoading,
  onRouteSelect,
  selectedRouteId
}: AllRoutesPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedZone, setSelectedZone] = useState<string>('all');
  const [open, setOpen] = useState(false);
  
  // Filtrar rutas por zona
  const zoneFilteredRoutes = selectedZone === 'all' 
    ? routes 
    : routes.filter(route => route.zone === selectedZone);
    
  // Ordenar rutas por número
  const sortedRoutes = [...zoneFilteredRoutes].sort((a, b) => {
    // Extraer el número de la ruta del nombre (ejemplo: "Ruta 1" -> 1)
    const getRouteNumber = (name: string) => {
      const match = name.match(/Ruta\s+(\d+)/i);
      return match ? parseInt(match[1], 10) : 999; // Default to high number if no match
    };
    
    return getRouteNumber(a.name) - getRouteNumber(b.name);
  });
  
  // Filtrar rutas por texto de búsqueda
  const filteredRoutes = sortedRoutes.filter(route => 
    route.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    route.shortName.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };
  
  const handleRouteSelect = (routeId: number) => {
    onRouteSelect(routeId);
    setOpen(false); // Cerrar el diálogo después de seleccionar
  };
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="default" 
          className="bg-green-600 text-white hover:bg-green-700 flex items-center gap-2 shadow-xl rounded-full px-6"
          size="lg"
        >
          <Map className="h-5 w-5" />
          <span className="hidden sm:inline">Todas las Rutas</span>
          <span className="sm:hidden">Rutas</span>
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
              value={searchQuery}
              onChange={handleSearch}
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
          {isLoading ? (
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
            filteredRoutes.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {filteredRoutes.map(route => (
                  <div 
                    key={route.id} 
                    className={`p-3 rounded-lg border ${selectedRouteId === route.id ? 'bg-green-50 border-green-300' : 'border-gray-200 hover:bg-gray-50'} 
                              cursor-pointer flex items-center space-x-3 transition-colors`}
                    onClick={() => handleRouteSelect(route.id)}
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
  );
}