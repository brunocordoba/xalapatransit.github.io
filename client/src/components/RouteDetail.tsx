import { X, Share2, Map } from 'lucide-react';
import { BusRoute, BusStop } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type RouteDetailProps = {
  route: BusRoute;
  stops: BusStop[];
  onClose: () => void;
  isLoading: boolean;
};

export default function RouteDetail({ route, stops, onClose, isLoading }: RouteDetailProps) {
  const terminalStops = stops.filter(stop => stop.isTerminal);
  const regularStops = stops.filter(stop => !stop.isTerminal);
  
  return (
    <div className="absolute bottom-4 left-4 right-4 md:left-auto md:w-96 bg-white rounded-lg shadow-lg overflow-hidden max-h-[70vh]">
      <div className="p-4 text-white flex justify-between items-center" style={{ backgroundColor: route.color }}>
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center font-bold" style={{ color: route.color }}>
            {route.shortName}
          </div>
          <h3 className="text-lg font-semibold">{route.name}</h3>
        </div>
        <Button variant="ghost" size="icon" className="text-white hover:bg-opacity-20 p-1 rounded-full" onClick={onClose}>
          <X className="h-6 w-6" />
        </Button>
      </div>
      
      <div className="p-4">
        <div className="mb-4">
          <h4 className="font-medium text-gray-700 mb-2">Información</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Frecuencia</p>
              <p className="font-medium">Cada {route.frequency}</p>
            </div>
            <div>
              <p className="text-gray-500">Horario</p>
              <p className="font-medium">{route.scheduleStart} - {route.scheduleEnd}</p>
            </div>
            <div>
              <p className="text-gray-500">Paradas</p>
              <p className="font-medium">{route.stopsCount} paradas</p>
            </div>
            <div>
              <p className="text-gray-500">Tiempo aprox.</p>
              <p className="font-medium">{route.approximateTime}</p>
            </div>
          </div>
        </div>
        
        <div>
          <h4 className="font-medium text-gray-700 mb-2">Paradas</h4>
          <div className="space-y-1 max-h-60 overflow-y-auto pr-2">
            {isLoading ? (
              // Skeleton loaders for stops
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-start mb-2">
                  <Skeleton className={`mt-1 ${i === 0 || i === 5 ? 'w-4 h-4' : 'w-2 h-2 ml-1'} rounded-full`} />
                  <div className="ml-3 pb-2 border-l border-gray-200 pl-3 -mt-1 w-full">
                    <Skeleton className="h-4 w-4/5 mb-1" />
                    {(i === 0 || i === 5) && <Skeleton className="h-3 w-2/5" />}
                  </div>
                </div>
              ))
            ) : (
              <>
                {/* First terminal */}
                {terminalStops.length > 0 && terminalStops[0] && (
                  <div className="flex items-start">
                    <div className="mt-1 w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: route.color }}></div>
                    <div className="ml-3 pb-2 border-l pl-3 -mt-1" style={{ borderColor: `${route.color}40` }}>
                      <p className="font-medium">{terminalStops[0].name}</p>
                      <p className="text-xs text-gray-500">Primera parada</p>
                    </div>
                  </div>
                )}
                
                {/* Regular stops */}
                {regularStops.map(stop => (
                  <div key={stop.id} className="flex items-start">
                    <div className="mt-1 w-2 h-2 rounded-full flex-shrink-0 ml-1" style={{ backgroundColor: `${route.color}90` }}></div>
                    <div className="ml-3 pb-2 border-l pl-3 -mt-1" style={{ borderColor: `${route.color}40` }}>
                      <p className="font-medium">{stop.name}</p>
                    </div>
                  </div>
                ))}
                
                {/* Last terminal */}
                {terminalStops.length > 1 && terminalStops[1] && (
                  <div className="flex items-start">
                    <div className="mt-1 w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: route.color }}></div>
                    <div className="ml-3 pl-3 -mt-1">
                      <p className="font-medium">{terminalStops[1].name}</p>
                      <p className="text-xs text-gray-500">Última parada</p>
                    </div>
                  </div>
                )}
                
                {stops.length === 0 && (
                  <p className="text-gray-500 text-sm">No hay información de paradas disponible.</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      
      <div className="p-4 border-t flex space-x-2">
        <Button variant="outline" className="flex-1 py-2 bg-gray-100 rounded-lg font-medium text-gray-700 hover:bg-gray-200 transition flex items-center justify-center">
          <Share2 className="h-5 w-5 mr-1" />
          Compartir
        </Button>
        <Button className="flex-1 py-2 bg-primary text-white rounded-lg font-medium hover:bg-blue-600 transition flex items-center justify-center">
          <Map className="h-5 w-5 mr-1" />
          Navegar
        </Button>
      </div>
    </div>
  );
}
