import * as fs from 'fs';

// Función para corregir el archivo KML
async function fixKmlFile() {
  try {
    // Leer el archivo KML original
    const originalContent = fs.readFileSync('./data/rutas-xalapa.kml', 'utf8');
    console.log(`Archivo KML leído: ${originalContent.length} bytes`);
    
    // Reemplazar etiquetas <n> por <name>
    let fixedContent = originalContent.replace(/<n>/g, '<name>').replace(/<\/n>/g, '</name>');
    
    // Escribir el archivo corregido
    fs.writeFileSync('./data/rutas-xalapa-fixed.kml', fixedContent);
    console.log('Archivo KML corregido guardado como rutas-xalapa-fixed.kml');
  } catch (error) {
    console.error('Error al procesar el archivo KML:', error);
  }
}

// Ejecutar
fixKmlFile().then(() => {
  console.log('Proceso completado');
  process.exit(0);
}).catch(err => {
  console.error('Error en el proceso:', err);
  process.exit(1);
});