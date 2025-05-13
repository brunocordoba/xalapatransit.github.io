import { BusRoute, BusStop } from '@shared/schema';
import {
  BusStopNode,
  RouteEdge,
  RouteGraph,
  buildRouteGraph,
  findNearestStop,
  getNeighbors,
  haversineDistance,
  estimateWalkingTime
} from './routeGraph';

// Estructura para representar un nodo en la búsqueda
interface SearchNode {
  id: number;
  g: number; // Costo acumulado
  h: number; // Heurística
  f: number; // f = g + h
  parent: SearchNode | null;
  edge: RouteEdge | null;
}

/**
 * Resultado de una ruta planificada
 */
export interface RouteResult {
  id: number;
  duration: string; // "XX min"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  steps: RouteStep[];
}

/**
 * Paso en una ruta planificada
 */
export interface RouteStep {
  type: 'bus' | 'walk';
  routeId?: number;
  routeName?: string;
  routeColor?: string;
  from: {
    stopId: number;
    stopName: string;
    coordinates: [number, number]; // [lon, lat]
  };
  to: {
    stopId: number;
    stopName: string;
    coordinates: [number, number]; // [lon, lat]
  };
  duration: string; // "XX min"
  distance: string; // "X.X km"
}

/**
 * Coordenadas para la planificación
 */
export interface PlanCoordinates {
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
}

/**
 * Implementación del algoritmo A* para encontrar la mejor ruta entre dos puntos
 */
export function findPath(
  graph: RouteGraph,
  startNode: BusStopNode,
  endNode: BusStopNode
): { path: BusStopNode[]; edges: RouteEdge[] } | null {
  // Conjunto de nodos por explorar (ordenados por menor f)
  const openSet: SearchNode[] = [];
  
  // Conjunto de nodos ya explorados
  const closedSet: Set<number> = new Set();
  
  // Inicializar nodo de inicio
  const startSearchNode: SearchNode = {
    id: startNode.id,
    g: 0,
    h: heuristic(startNode, endNode),
    f: heuristic(startNode, endNode),
    parent: null,
    edge: null
  };
  
  openSet.push(startSearchNode);
  
  // Mapa para rastrear nodos durante la búsqueda
  const nodeMap = new Map<number, SearchNode>();
  nodeMap.set(startNode.id, startSearchNode);
  
  while (openSet.length > 0) {
    // Ordenar para obtener el nodo con menor f
    openSet.sort((a, b) => a.f - b.f);
    
    // Obtener el nodo con menor f
    const current = openSet.shift()!;
    
    // Si llegamos al destino, reconstruir el camino
    if (current.id === endNode.id) {
      return reconstructPath(current, graph);
    }
    
    // Marcar como procesado
    closedSet.add(current.id);
    
    // Explorar vecinos
    const neighbors = getNeighbors(graph, current.id);
    
    for (const { node: neighbor, edge } of neighbors) {
      // Ignorar nodos ya procesados
      if (closedSet.has(neighbor.id)) {
        continue;
      }
      
      // Calcular nuevo costo g (costo acumulado)
      const tentativeG = current.g + edge.weight;
      
      // Verificar si es un nuevo nodo o si tiene un mejor camino
      let neighborNode = nodeMap.get(neighbor.id);
      let isNewPath = false;
      
      if (!neighborNode) {
        // Nuevo nodo
        neighborNode = {
          id: neighbor.id,
          g: tentativeG,
          h: heuristic(neighbor, endNode),
          f: tentativeG + heuristic(neighbor, endNode),
          parent: current,
          edge: edge
        };
        nodeMap.set(neighbor.id, neighborNode);
        openSet.push(neighborNode);
        isNewPath = true;
      } else if (tentativeG < neighborNode.g) {
        // Mejor camino
        neighborNode.g = tentativeG;
        neighborNode.f = tentativeG + neighborNode.h;
        neighborNode.parent = current;
        neighborNode.edge = edge;
        isNewPath = true;
        
        // Si no está en openSet, añadirlo
        if (!openSet.some(n => n.id === neighborNode!.id)) {
          openSet.push(neighborNode);
        }
      }
    }
  }
  
  // No se encontró camino
  return null;
}

/**
 * Heurística para A* - Distancia en línea recta entre nodos
 */
function heuristic(node: BusStopNode, target: BusStopNode): number {
  const distance = haversineDistance(
    node.latitude,
    node.longitude,
    target.latitude,
    target.longitude
  );
  
  // Convertir a minutos con velocidad optimista (bus rápido sin paradas)
  return (distance / 1000) / 40 * 60; // 40 km/h
}

/**
 * Reconstruir el camino a partir del nodo final
 */
function reconstructPath(
  endSearchNode: SearchNode,
  graph: RouteGraph
): { path: BusStopNode[]; edges: RouteEdge[] } {
  const path: BusStopNode[] = [];
  const edges: RouteEdge[] = [];
  
  let current: SearchNode | null = endSearchNode;
  
  while (current !== null) {
    const node = graph.nodes.get(current.id);
    if (node) {
      path.unshift(node);
    }
    
    if (current.edge) {
      edges.unshift(current.edge);
    }
    
    current = current.parent;
  }
  
  return { path, edges };
}

/**
 * Construye el resultado final de una ruta planificada
 */
function buildRouteResult(
  path: BusStopNode[],
  edges: RouteEdge[],
  graph: RouteGraph,
  startTime: Date = new Date()
): RouteResult {
  // Calcular duración total
  const totalDuration = edges.reduce((total, edge) => total + edge.weight, 0);
  
  // Inicializar el tiempo
  let currentTime = new Date(startTime);
  const endTime = new Date(startTime.getTime() + totalDuration * 60 * 1000);
  
  // Formatear tiempos
  const startTimeStr = `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}`;
  const endTimeStr = `${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`;
  
  // Crear pasos de la ruta
  const steps: RouteStep[] = [];
  
  let currentRouteId: number | null = null;
  let stepStart: number | null = null;
  
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const fromNode = graph.nodes.get(edge.sourceId)!;
    const toNode = graph.nodes.get(edge.targetId)!;
    
    // Si cambia el tipo de ruta, crear un nuevo paso
    if (edge.routeId !== currentRouteId || stepStart === null) {
      if (stepStart !== null && currentRouteId !== null) {
        // Finalizar paso anterior
        const stepEnd = edge.sourceId;
        const stepStartNode = graph.nodes.get(stepStart)!;
        const stepEndNode = graph.nodes.get(stepEnd)!;
        
        // Calcular duración y distancia para este tramo
        let stepDuration = 0;
        let stepDistance = 0;
        
        // Sumar peso de las aristas en este tramo
        for (let j = i - 1; j >= 0; j--) {
          const prevEdge = edges[j];
          if (prevEdge.routeId === currentRouteId) {
            stepDuration += prevEdge.weight;
            stepDistance += prevEdge.distance;
          } else {
            break;
          }
        }
        
        // Crear paso
        steps.push({
          type: currentRouteId === -1 ? 'walk' : 'bus',
          routeId: currentRouteId === -1 ? undefined : currentRouteId,
          routeName: currentRouteId === -1 ? undefined : graph.routeIdToName.get(currentRouteId),
          routeColor: currentRouteId === -1 ? undefined : graph.routeIdToColor.get(currentRouteId),
          from: {
            stopId: stepStartNode.id,
            stopName: stepStartNode.name,
            coordinates: [stepStartNode.longitude, stepStartNode.latitude]
          },
          to: {
            stopId: stepEndNode.id,
            stopName: stepEndNode.name,
            coordinates: [stepEndNode.longitude, stepEndNode.latitude]
          },
          duration: `${Math.round(stepDuration)} min`,
          distance: `${(stepDistance / 1000).toFixed(1)} km`
        });
      }
      
      // Iniciar nuevo paso
      stepStart = edge.sourceId;
      currentRouteId = edge.routeId;
    }
    
    // Si es el último tramo, cerrarlo
    if (i === edges.length - 1) {
      const stepStartNode = graph.nodes.get(stepStart)!;
      const stepEndNode = toNode;
      
      // Calcular duración y distancia para el último tramo
      let stepDuration = edge.weight;
      let stepDistance = edge.distance;
      
      // Sumar peso de las aristas en este tramo
      for (let j = i - 1; j >= 0; j--) {
        const prevEdge = edges[j];
        if (prevEdge.routeId === currentRouteId) {
          stepDuration += prevEdge.weight;
          stepDistance += prevEdge.distance;
        } else {
          break;
        }
      }
      
      // Crear paso final
      steps.push({
        type: currentRouteId === -1 ? 'walk' : 'bus',
        routeId: currentRouteId === -1 ? undefined : currentRouteId,
        routeName: currentRouteId === -1 ? undefined : graph.routeIdToName.get(currentRouteId),
        routeColor: currentRouteId === -1 ? undefined : graph.routeIdToColor.get(currentRouteId),
        from: {
          stopId: stepStartNode.id,
          stopName: stepStartNode.name,
          coordinates: [stepStartNode.longitude, stepStartNode.latitude]
        },
        to: {
          stopId: stepEndNode.id,
          stopName: stepEndNode.name,
          coordinates: [stepEndNode.longitude, stepEndNode.latitude]
        },
        duration: `${Math.round(stepDuration)} min`,
        distance: `${(stepDistance / 1000).toFixed(1)} km`
      });
    }
  }
  
  return {
    id: 1, // ID único para la ruta
    duration: `${Math.round(totalDuration)} min`,
    startTime: startTimeStr,
    endTime: endTimeStr,
    steps
  };
}

/**
 * Busca rutas entre dos puntos de coordenadas
 */
export async function planRoute(
  coordinates: PlanCoordinates,
  stops: BusStop[],
  routes: BusRoute[],
  startTime: Date = new Date(),
  maxResults: number = 3
): Promise<RouteResult[]> {
  // Construir el grafo de rutas
  console.time('buildGraph');
  const graph = buildRouteGraph(stops, routes);
  console.timeEnd('buildGraph');
  
  console.log(`Grafo construido con ${graph.nodes.size} nodos y ${graph.edges.length} aristas`);
  
  // Encontrar paradas más cercanas al origen y destino
  const originStop = findNearestStop(
    graph,
    coordinates.originLat,
    coordinates.originLng
  );
  
  const destinationStop = findNearestStop(
    graph,
    coordinates.destinationLat,
    coordinates.destinationLng
  );
  
  if (!originStop || !destinationStop) {
    console.error('No se encontraron paradas cercanas al origen o destino');
    return [];
  }
  
  console.log(`Parada origen: ${originStop.name} (${originStop.id})`);
  console.log(`Parada destino: ${destinationStop.name} (${destinationStop.id})`);
  
  // Calcular distancia y tiempo de caminata desde el punto de origen a la parada
  const originWalkDistance = haversineDistance(
    coordinates.originLat,
    coordinates.originLng,
    originStop.latitude,
    originStop.longitude
  );
  
  const originWalkTime = estimateWalkingTime(originWalkDistance);
  
  // Calcular distancia y tiempo de caminata desde la parada al punto de destino
  const destWalkDistance = haversineDistance(
    destinationStop.latitude,
    destinationStop.longitude,
    coordinates.destinationLat,
    coordinates.destinationLng
  );
  
  const destWalkTime = estimateWalkingTime(destWalkDistance);
  
  // Encontrar la mejor ruta entre las paradas
  console.time('findPath');
  const pathResult = findPath(graph, originStop, destinationStop);
  console.timeEnd('findPath');
  
  // Verificar si se encontró una ruta
  if (!pathResult) {
    console.error('No se encontró ruta entre las paradas');
    return [];
  }
  
  // Construir el resultado con los tramos de caminata al inicio y final
  const { path, edges } = pathResult;
  
  console.log(`Ruta encontrada con ${path.length} nodos y ${edges.length} aristas`);
  
  // Ajustar tiempo de salida para incluir la caminata inicial
  const adjustedStartTime = new Date(startTime.getTime() - originWalkTime * 60 * 1000);
  
  // Construir el resultado final
  const result = buildRouteResult(path, edges, graph, adjustedStartTime);
  
  // Añadir caminata inicial y final si son significativas (más de 50 metros)
  if (originWalkDistance > 50) {
    result.steps.unshift({
      type: 'walk',
      from: {
        stopId: -1, // ID ficticio para el punto de origen
        stopName: 'Punto de origen',
        coordinates: [coordinates.originLng, coordinates.originLat]
      },
      to: {
        stopId: originStop.id,
        stopName: originStop.name,
        coordinates: [originStop.longitude, originStop.latitude]
      },
      duration: `${Math.round(originWalkTime)} min`,
      distance: `${(originWalkDistance / 1000).toFixed(1)} km`
    });
  }
  
  if (destWalkDistance > 50) {
    result.steps.push({
      type: 'walk',
      from: {
        stopId: destinationStop.id,
        stopName: destinationStop.name,
        coordinates: [destinationStop.longitude, destinationStop.latitude]
      },
      to: {
        stopId: -2, // ID ficticio para el punto de destino
        stopName: 'Punto de destino',
        coordinates: [coordinates.destinationLng, coordinates.destinationLat]
      },
      duration: `${Math.round(destWalkTime)} min`,
      distance: `${(destWalkDistance / 1000).toFixed(1)} km`
    });
  }
  
  // Ajustar la duración total para incluir caminatas
  const totalDuration = 
    result.steps.reduce((total, step) => {
      return total + parseInt(step.duration.split(' ')[0]);
    }, 0);
  
  result.duration = `${totalDuration} min`;
  
  // Ajustar el tiempo de fin para incluir todas las caminatas
  const finalEndTime = new Date(adjustedStartTime.getTime() + totalDuration * 60 * 1000);
  result.endTime = `${finalEndTime.getHours().toString().padStart(2, '0')}:${finalEndTime.getMinutes().toString().padStart(2, '0')}`;
  
  // Por ahora, solo devolvemos una ruta, pero podríamos calcular alternativas
  return [result];
}