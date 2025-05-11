// Default map center coordinates for Xalapa
export const XALAPA_CENTER: [number, number] = [19.542, -96.9271];

// Default zoom level
export const DEFAULT_ZOOM = 13;

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
