import { BusStop, BusRoute } from '@shared/schema';

// Tipos para el grafo de rutas
export interface BusStopNode {
  id: number;
  latitude: number;
  longitude: number;
  name: string;
  routeIds: Set<number>;
  isTransfer?: boolean;
}

export interface RouteEdge {
  sourceId: number;
  targetId: number;
  routeId: number;
  weight: number; // Peso en tiempo (minutos)
  distance: number; // Distancia en metros
}

export interface RouteGraph {
  nodes: Map<number, BusStopNode>;
  edges: RouteEdge[];
  routeIdToColor: Map<number, string>;
  routeIdToName: Map<number, string>;
}

// Constantes
const AVERAGE_BUS_SPEED = 20; // km/h
const TRANSFER_PENALTY = 5; // Minutos por transferencia
const WALKING_SPEED = 5; // km/h

// Función para calcular distancia entre coordenadas geográficas (Haversine)
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Radio de la Tierra en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance * 1000; // Convertir a metros
}

// Función para estimar el tiempo entre dos paradas
export function estimateTravelTime(distance: number): number {
  // Convertir distancia (metros) a tiempo (minutos)
  // Velocidad promedio del bus: 20 km/h
  return (distance / 1000 / AVERAGE_BUS_SPEED) * 60;
}

// Función para estimar el tiempo de caminata
export function estimateWalkingTime(distance: number): number {
  // Convertir distancia (metros) a tiempo (minutos)
  // Velocidad promedio de caminata: 5 km/h
  return (distance / 1000 / WALKING_SPEED) * 60;
}

// Construir el grafo a partir de paradas y rutas
export function buildRouteGraph(stops: BusStop[], routes: BusRoute[]): RouteGraph {
  const graph: RouteGraph = {
    nodes: new Map<number, BusStopNode>(),
    edges: [],
    routeIdToColor: new Map<number, string>(),
    routeIdToName: new Map<number, string>()
  };

  // Mapear rutas a colores y nombres
  routes.forEach(route => {
    graph.routeIdToColor.set(route.id, route.color || '#3388ff');
    graph.routeIdToName.set(route.id, route.name);
  });

  // Crear nodos para cada parada
  stops.forEach(stop => {
    const latitude = parseFloat(stop.latitude);
    const longitude = parseFloat(stop.longitude);
    
    if (isNaN(latitude) || isNaN(longitude)) {
      console.warn(`Parada con coordenadas inválidas: ${stop.id}, ${stop.name}`);
      return;
    }
    
    const node: BusStopNode = {
      id: stop.id,
      latitude,
      longitude,
      name: stop.name,
      routeIds: new Set<number>([stop.routeId])
    };
    
    // Si el nodo ya existe, agregamos la ruta al conjunto de rutas
    if (graph.nodes.has(stop.id)) {
      const existingNode = graph.nodes.get(stop.id)!;
      existingNode.routeIds.add(stop.routeId);
      // Marcar como nodo de transferencia si tiene más de una ruta
      if (existingNode.routeIds.size > 1) {
        existingNode.isTransfer = true;
      }
    } else {
      graph.nodes.set(stop.id, node);
    }
  });

  // Crear aristas entre paradas de la misma ruta en orden secuencial
  routes.forEach(route => {
    const routeStops = stops.filter(stop => stop.routeId === route.id)
      // Ordenar por el campo order si existe, sino usar el ID como respaldo
      .sort((a, b) => {
        // Si ambos tienen order, usamos ese campo
        if (a.order !== undefined && b.order !== undefined) {
          return (a.order || 0) - (b.order || 0);
        }
        // Si no, ordenamos por ID como respaldo
        return a.id - b.id;
      });
    
    // Conectar paradas adyacentes en la misma ruta
    for (let i = 0; i < routeStops.length - 1; i++) {
      const source = routeStops[i];
      const target = routeStops[i + 1];
      
      // Verificar que ambas paradas tengan nodos en el grafo
      if (!graph.nodes.has(source.id) || !graph.nodes.has(target.id)) {
        continue;
      }
      
      const sourceNode = graph.nodes.get(source.id)!;
      const targetNode = graph.nodes.get(target.id)!;
      
      const distance = haversineDistance(
        sourceNode.latitude,
        sourceNode.longitude,
        targetNode.latitude,
        targetNode.longitude
      );
      
      const weight = estimateTravelTime(distance);
      
      // Crear arista entre las paradas
      graph.edges.push({
        sourceId: source.id,
        targetId: target.id,
        routeId: route.id,
        weight,
        distance
      });
    }
  });

  // Añadir aristas para transferencias entre paradas cercanas (distancia caminable)
  const MAX_WALKING_DISTANCE = 500; // metros
  const nodeArray = Array.from(graph.nodes.values());
  
  for (let i = 0; i < nodeArray.length; i++) {
    const nodeA = nodeArray[i];
    
    for (let j = i + 1; j < nodeArray.length; j++) {
      const nodeB = nodeArray[j];
      
      // Verificar si las paradas pertenecen a rutas diferentes
      const hasCommonRoute = Array.from(nodeA.routeIds).some(routeId => 
        nodeB.routeIds.has(routeId)
      );
      
      if (!hasCommonRoute) {
        const distance = haversineDistance(
          nodeA.latitude,
          nodeA.longitude,
          nodeB.latitude,
          nodeB.longitude
        );
        
        // Si están suficientemente cerca, crear una arista de transferencia
        if (distance <= MAX_WALKING_DISTANCE) {
          const walkingTime = estimateWalkingTime(distance);
          
          // Añadir aristas en ambos sentidos
          graph.edges.push({
            sourceId: nodeA.id,
            targetId: nodeB.id,
            routeId: -1, // -1 indica transferencia/caminata
            weight: walkingTime + TRANSFER_PENALTY, // Añadir penalización por transferencia
            distance
          });
          
          graph.edges.push({
            sourceId: nodeB.id,
            targetId: nodeA.id,
            routeId: -1, // -1 indica transferencia/caminata
            weight: walkingTime + TRANSFER_PENALTY, // Añadir penalización por transferencia
            distance
          });
        }
      }
    }
  }

  return graph;
}

// Obtener vecinos de un nodo
export function getNeighbors(graph: RouteGraph, nodeId: number): { node: BusStopNode; edge: RouteEdge }[] {
  const neighbors: { node: BusStopNode; edge: RouteEdge }[] = [];
  
  graph.edges
    .filter(edge => edge.sourceId === nodeId)
    .forEach(edge => {
      const targetNode = graph.nodes.get(edge.targetId);
      if (targetNode) {
        neighbors.push({ node: targetNode, edge });
      }
    });
  
  return neighbors;
}

// Encontrar la parada más cercana a unas coordenadas
export function findNearestStop(
  graph: RouteGraph,
  latitude: number,
  longitude: number,
  maxDistance: number = 1000 // metros
): BusStopNode | null {
  let nearestNode: BusStopNode | null = null;
  let minDistance = Infinity;
  
  // Convertir a array para evitar problemas de iteración
  const nodesArray = Array.from(graph.nodes.values());
  
  for (const node of nodesArray) {
    const distance = haversineDistance(
      latitude,
      longitude,
      node.latitude,
      node.longitude
    );
    
    if (distance < minDistance && distance <= maxDistance) {
      minDistance = distance;
      nearestNode = node;
    }
  }
  
  return nearestNode;
}