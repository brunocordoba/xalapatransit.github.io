import * as fs from 'fs';
import { storage } from '../server/storage';

// Archivos de referencia
const REFERENCE_FILE = './attached_assets/2017-03-04_04-27_route.json';
const REFERENCE_STOPS = './attached_assets/2017-03-04_04-27_stops.json';

// Función para importar la ruta de referencia original
async function importReferenceRoute() {
  console.log('Importando ruta de referencia original...');
  
  try {
    // Cargar los archivos JSON de ruta y paradas
    const routeData = JSON.parse(fs.readFileSync(REFERENCE_FILE, 'utf8'));
    const stopsData = JSON.parse(fs.readFileSync(REFERENCE_STOPS, 'utf8'));
    
    console.log(`Datos cargados: ${routeData.features.length} rutas y ${stopsData.features.length} paradas`);
    
    // Procesar la ruta (solo debería haber una)
    for (const routeFeature of routeData.features) {
      const properties = routeFeature.properties;
      const geometry = routeFeature.geometry;
      
      const routeId = 10001;  // ID específico para la ruta original
      const routeName = "Ruta 10001 (Original)";
      const routeDesc = properties.desc || '';
      const coordinates = geometry.coordinates as [number, number][];
      
      // Zona y color para la ruta
      const zoneName = 'centro';
      const color = '#F97316';  // orange-500
      
      // Crear objeto GeoJSON para la ruta
      const routeGeoJSON = {
        type: "Feature",
        properties: {
          id: routeId,
          name: routeName,
          shortName: "R10001",
          color: color
        },
        geometry: {
          type: "LineString",
          coordinates: coordinates
        }
      };
      
      // Crear la ruta en la base de datos
      const route = await storage.createRoute({
        name: routeName,
        shortName: "R10001",
        color: color,
        frequency: "10 minutos",
        scheduleStart: "05:30 AM",
        scheduleEnd: "10:30 PM",
        stopsCount: stopsData.features.length,
        approximateTime: "45 minutos",
        zone: zoneName,
        popular: true,
        geoJSON: routeGeoJSON
      });
      
      console.log(`Ruta de referencia creada: ${route.name} (ID: ${route.id})`);
      
      // Procesar todas las paradas
      for (let i = 0; i < stopsData.features.length; i++) {
        const stopFeature = stopsData.features[i];
        
        if (!stopFeature.properties || !stopFeature.geometry) {
          console.log('Parada inválida, omitiendo...');
          continue;
        }
        
        const stopCoords = stopFeature.geometry.coordinates as [number, number];
        const isTerminal = i === 0 || i === stopsData.features.length - 1;
        const terminalType = i === 0 ? 'first' : (i === stopsData.features.length - 1 ? 'last' : '');
        
        const stopName = isTerminal 
          ? (i === 0 ? `Terminal Origen (R10001)` : `Terminal Destino (R10001)`)
          : `Parada ${i}`;
        
        await storage.createStop({
          routeId: route.id,
          name: stopName,
          latitude: stopCoords[1].toString(),
          longitude: stopCoords[0].toString(),
          isTerminal: isTerminal,
          terminalType: terminalType
        });
      }
      
      console.log(`Añadidas ${stopsData.features.length} paradas a la ruta ${route.id}`);
    }
    
    console.log('Importación de ruta de referencia completada');
  } catch (error) {
    console.error('Error importando ruta de referencia:', error);
    throw error;
  }
}

// Ejecutar la importación
async function main() {
  try {
    await importReferenceRoute();
    console.log('Proceso completado con éxito');
    process.exit(0);
  } catch (error) {
    console.error('Error fatal:', error);
    process.exit(1);
  }
}

main();