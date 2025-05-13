// Default map center coordinates for Xalapa
export const XALAPA_CENTER: [number, number] = [19.542, -96.9271];

// Default zoom level
export const DEFAULT_ZOOM = 13;

// Límites de la ciudad de Xalapa ajustados a la imagen de referencia
// [lat min, lng min, lat max, lng max]
export const XALAPA_BOUNDS: [[number, number], [number, number]] = [
  [19.385, -97.097], // Esquina suroeste: [latMin, lngMin] (incluye Coatepec)
  [19.685, -96.776]  // Esquina noreste: [latMax, lngMax] (incluye Banderilla y alrededores)
];

// Nivel mínimo de zoom permitido (zoom exacto como en la imagen de referencia)
export const MIN_ZOOM = 9.5;

// Nivel máximo de zoom permitido
export const MAX_ZOOM = 18;

// Zone definitions
export const zones = [
  { value: 'norte', label: 'Norte' },
  { value: 'sur', label: 'Sur' },
  { value: 'este', label: 'Este' },
  { value: 'oeste', label: 'Oeste' },
  { value: 'centro', label: 'Centro' }
];

// Route colors by zone
export const zoneColors = {
  norte: '#EF4444', // red-500
  sur: '#3B82F6',   // blue-500
  este: '#22C55E',  // green-500
  oeste: '#A855F7', // purple-500
  centro: '#F97316' // orange-500
};

// Default frequency options
export const frequencyOptions = [
  '10 minutos',
  '15 minutos',
  '20 minutos',
  '30 minutos',
  '45 minutos',
  '60 minutos'
];

// Una paleta de colores vibrantes y bien diferenciados (40 colores)
export const colorPalette = [
  '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080',
  '#008000', '#800000', '#000080', '#FF4500', '#8B4513', '#2E8B57', '#4B0082', '#F4A460',
  '#9370DB', '#00CED1', '#FF6347', '#7CFC00', '#DC143C', '#00BFFF', '#808000', '#FF1493',
  '#008080', '#FFD700', '#4682B4', '#9932CC', '#8FBC8F', '#B22222', '#48D1CC', '#BDB76B',
  '#FF8C00', '#32CD32', '#8A2BE2', '#FF69B4', '#1E90FF', '#00FA9A', '#DAA520', '#9400D3'
];

/**
 * Genera un color único para una ruta basado en su ID
 * @param routeId ID de la ruta
 * @param zone Zona de la ruta (opcional)
 * @returns Color en formato hexadecimal
 */
export function getUniqueRouteColor(routeId: number, zone?: string): string {
  // Si la zona está definida y queremos agrupar por colores de zona, descomentar esto
  // if (zone && zoneColors[zone]) {
  //   return zoneColors[zone];
  // }
  
  // Usamos el ID de la ruta para seleccionar un color de la paleta
  const colorIndex = (routeId % colorPalette.length);
  const baseColor = colorPalette[colorIndex];
  
  // Aplicamos una ligera variación al color según el ID para hacerlo único
  // incluso si hay más rutas que colores en la paleta
  const variation = Math.floor(routeId / colorPalette.length);
  if (variation === 0) {
    return baseColor;
  }
  
  // Convertimos el color hex a RGB, modificamos ligeramente y volvemos a hex
  const r = parseInt(baseColor.substring(1, 3), 16);
  const g = parseInt(baseColor.substring(3, 5), 16);
  const b = parseInt(baseColor.substring(5, 7), 16);
  
  // Aplicamos un ajuste basado en el factor de variación
  const adjustR = (r + 10 * variation) % 255;
  const adjustG = (g + 7 * variation) % 255;
  const adjustB = (b + 13 * variation) % 255;
  
  // Convertimos de vuelta a hexadecimal
  return `#${adjustR.toString(16).padStart(2, '0')}${adjustG.toString(16).padStart(2, '0')}${adjustB.toString(16).padStart(2, '0')}`;
}
