-- Script para verificar y borrar falsos duplicados de bus_routes
SELECT 'Verificando posibles rutas fantasma en la base de datos...';

-- Primero verificamos las rutas 34-44 (Alternativa 1) que creemos que se insertaron
SELECT 'Rutas fantasma con alternativa 1:';
SELECT name FROM bus_routes WHERE name SIMILAR TO 'Ruta (34|35|36|37|38|39|40|41|42|43|44) (Alternativa 1)';

-- Luego verificamos las rutas 34-44 (Alternativa 2)
SELECT 'Rutas fantasma con alternativa 2:';
SELECT name FROM bus_routes WHERE name SIMILAR TO 'Ruta (34|35|36|37|38|39|40|41|42|43|44) (Alternativa 2)';

-- Luego listamos las rutas alternativas que ya existían
SELECT 'Rutas alternativas posiblemente existentes:';
SELECT name FROM bus_routes WHERE name LIKE 'Ruta % (Alternativa %)';