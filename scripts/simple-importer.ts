import * as fs from 'fs';
import { db } from '../server/db';
import { busRoutes, busStops } from '../shared/schema';
import { storage } from '../server/storage';

// Función para importar las rutas
async function importRoutes() {
  console.log('Importando rutas de autobús...');
  
  // Eliminar datos existentes
  await db.delete(busStops);
  await db.delete(busRoutes);
  
  // Rangos de ID para las diferentes zonas
  const ZONES = ['norte', 'sur', 'este', 'oeste', 'centro'];
  const ZONE_COLORS = {
    'norte': '#EF4444',  // red-500
    'sur': '#3B82F6',    // blue-500
    'este': '#22C55E',   // green-500
    'oeste': '#A855F7',  // purple-500
    'centro': '#F97316'  // orange-500
  };
  
  // Crear 40 rutas (8 por cada zona)
  let routeCount = 0;
  let stopCount = 0;
  
  for (let zoneIndex = 0; zoneIndex < ZONES.length; zoneIndex++) {
    const zone = ZONES[zoneIndex];
    const color = ZONE_COLORS[zone];
    
    for (let i = 0; i < 8; i++) {
      const routeId = zoneIndex * 10 + i + 1;
      const routeName = `Ruta ${routeId}`;
      
      // Destinos por zonas
      let originDestination = '';
      switch (zone) {
        case 'norte':
          originDestination = 'Centro → Animas';
          break;
        case 'sur':
          originDestination = 'Centro → Trancas';
          break;
        case 'este':
          originDestination = 'Centro → Universidad';
          break;
        case 'oeste':
          originDestination = 'Centro → Coapexpan';
          break;
        case 'centro':
          originDestination = 'Circuito Centro';
          break;
      }
      
      // Crear coordenadas que forman un recorrido
      // Centro de Xalapa: [19.542, -96.9271]
      const center = [19.542, -96.9271];
      let coordinates: [number, number][] = [];
      
      // Generar ruta (forma de estrella desde el centro)
      const pointCount = 5 + Math.floor(Math.random() * 10);
      const radiusKm = 0.5 + Math.random() * 2;
      
      for (let j = 0; j < pointCount; j++) {
        const angle = (j / pointCount) * Math.PI * 2;
        // Ajustar dirección según la zona
        const zoneOffset = zoneIndex * (Math.PI / 2.5);
        const direction = angle + zoneOffset;
        
        // Convertir a coordenadas
        const latitude = center[0] + Math.sin(direction) * radiusKm * 0.009;
        const longitude = center[1] + Math.cos(direction) * radiusKm * 0.009;
        
        coordinates.push([longitude, latitude]);
      }
      
      // Objeto GeoJSON
      const geoJSON = {
        type: "Feature",
        properties: {
          id: routeId,
          name: routeName,
          shortName: `R${routeId}`,
          color: color
        },
        geometry: {
          type: "LineString",
          coordinates: coordinates
        }
      };
      
      // Crear el registro de ruta
      const route = await storage.createRoute({
        name: `${routeName} - ${originDestination}`,
        shortName: `R${routeId}`,
        color: color,
        frequency: '15 minutos',
        scheduleStart: '05:30 AM',
        scheduleEnd: '10:30 PM',
        stopsCount: coordinates.length,
        approximateTime: '45 minutos',
        zone: zone,
        popular: routeCount < 5,
        geoJSON: geoJSON
      });
      
      console.log(`Ruta creada: ${route.name}`);
      routeCount++;
      
      // Crear paradas para esta ruta
      const numStops = Math.min(5, coordinates.length);
      const step = Math.floor(coordinates.length / numStops);
      
      // Terminal origen
      await storage.createStop({
        routeId: route.id,
        name: `Terminal ${originDestination.split('→')[0].trim()}`,
        latitude: coordinates[0][1].toString(),
        longitude: coordinates[0][0].toString(),
        isTerminal: true,
        terminalType: 'first'
      });
      stopCount++;
      
      // Paradas intermedias
      for (let j = 1; j < numStops - 1; j++) {
        const index = j * step;
        if (index < coordinates.length) {
          await storage.createStop({
            routeId: route.id,
            name: `Parada ${j}`,
            latitude: coordinates[index][1].toString(),
            longitude: coordinates[index][0].toString(),
            isTerminal: false,
            terminalType: ''
          });
          stopCount++;
        }
      }
      
      // Terminal destino
      const lastIndex = coordinates.length - 1;
      await storage.createStop({
        routeId: route.id,
        name: `Terminal ${originDestination.includes('→') ? originDestination.split('→')[1].trim() : 'Destino'}`,
        latitude: coordinates[lastIndex][1].toString(),
        longitude: coordinates[lastIndex][0].toString(),
        isTerminal: true,
        terminalType: 'last'
      });
      stopCount++;
    }
  }
  
  console.log(`Importación completada: ${routeCount} rutas y ${stopCount} paradas creadas.`);
}

// Función principal
async function main() {
  try {
    await importRoutes();
    console.log('Proceso de importación completado con éxito.');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();