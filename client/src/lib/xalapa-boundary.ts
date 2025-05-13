// GeoJSON que define el contorno de la ciudad de Xalapa
// Coordenadas obtenidas como aproximación del perímetro urbano

export const xalapaBoundary = {
  "type": "Feature",
  "properties": {
    "name": "Xalapa",
    "description": "Límite municipal de Xalapa, Veracruz"
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[
      // Coordenadas [longitud, latitud] que forman el polígono de Xalapa
      [-96.9719, 19.5177],  // Punto noroeste
      [-96.9614, 19.5787],  // Norte
      [-96.9360, 19.5948],  // Norte
      [-96.9030, 19.5900],  // Noreste
      [-96.8760, 19.5790],  // Noreste
      [-96.8560, 19.5650],  // Este
      [-96.8400, 19.5450],  // Este
      [-96.8560, 19.5190],  // Sureste
      [-96.8670, 19.5050],  // Sureste
      [-96.8760, 19.4850],  // Sur
      [-96.9010, 19.4680],  // Sur
      [-96.9250, 19.4600],  // Suroeste
      [-96.9450, 19.4650],  // Suroeste
      [-96.9680, 19.4750],  // Oeste
      [-96.9800, 19.4950],  // Oeste
      [-96.9719, 19.5177]   // Cerramos el polígono con el punto inicial
    ]]
  }
};

// Estilos para el contorno de la ciudad
export const boundaryStyle = {
  color: '#388e3c',         // Color verde para el borde
  weight: 3,                // Grosor de la línea
  opacity: 0.8,             // Opacidad del borde
  fillColor: '#4caf50',     // Color de relleno verde más claro
  fillOpacity: 0.08,        // Opacidad muy baja para el relleno
  dashArray: '5, 8',        // Patrón de línea discontinua
};