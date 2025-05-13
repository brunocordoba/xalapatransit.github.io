// Puntos de interés de Xalapa
// Incluye lugares importantes de la ciudad que pueden ser útiles para los usuarios

export interface PointOfInterest {
  name: string;
  type: 'landmark' | 'education' | 'transport' | 'government' | 'park' | 'hospital';
  coordinates: [number, number]; // [latitud, longitud]
  description: string;
  icon?: string; // Clase CSS o nombre de icono de Lucide
}

export const xalapaPOIs: PointOfInterest[] = [
  {
    name: "Palacio de Gobierno",
    type: "government",
    coordinates: [19.5304, -96.9215],
    description: "Sede del Gobierno del Estado de Veracruz"
  },
  {
    name: "Catedral Metropolitana",
    type: "landmark",
    coordinates: [19.5290, -96.9265],
    description: "Catedral de la Inmaculada Concepción"
  },
  {
    name: "Universidad Veracruzana",
    type: "education",
    coordinates: [19.5400, -96.9270],
    description: "Principal universidad pública del estado"
  },
  {
    name: "Parque Juárez",
    type: "park",
    coordinates: [19.5320, -96.9248],
    description: "Parque público más importante del centro"
  },
  {
    name: "Teatro del Estado",
    type: "landmark",
    coordinates: [19.5250, -96.9205],
    description: "Principal recinto cultural de la ciudad"
  },
  {
    name: "Museo de Antropología",
    type: "landmark",
    coordinates: [19.5455, -96.9270],
    description: "Museo con importante colección arqueológica"
  },
  {
    name: "Terminal de Autobuses",
    type: "transport",
    coordinates: [19.5360, -96.8934],
    description: "Terminal central de autobuses CAXA"
  },
  {
    name: "Hospital Regional",
    type: "hospital",
    coordinates: [19.5420, -96.9175],
    description: "Hospital Civil 'Dr. Luis F. Nachón'"
  },
  {
    name: "Paseo de Los Lagos",
    type: "park",
    coordinates: [19.5158, -96.9150],
    description: "Área recreativa con lagos artificiales"
  },
  {
    name: "Estadio Xalapeño",
    type: "landmark",
    coordinates: [19.5278, -96.9057],
    description: "Principal estadio deportivo de la ciudad"
  }
];

// Función para obtener el ícono según el tipo de POI
export function getPOIIcon(type: PointOfInterest['type']): string {
  switch (type) {
    case 'landmark':
      return 'landmark text-yellow-600';
    case 'education':
      return 'school text-blue-600';
    case 'transport':
      return 'bus text-red-600';
    case 'government':
      return 'building text-purple-600';
    case 'park':
      return 'tree text-green-600';
    case 'hospital':
      return 'first-aid text-red-500';
    default:
      return 'map-pin text-gray-600';
  }
}