#!/bin/bash

# Script para ejecutar el ajuste de rutas a carreteras usando Mapbox

# Verificar que TOKEN de Mapbox está configurado
if [ -z "$MAPBOX_ACCESS_TOKEN" ]; then
    echo "Error: MAPBOX_ACCESS_TOKEN no está configurado."
    echo "Por favor, configura la variable de entorno MAPBOX_ACCESS_TOKEN."
    exit 1
fi

# Mostrar ayuda
show_help() {
    echo "Uso: ./run-snap-to-road.sh [OPCIÓN]"
    echo ""
    echo "Opciones:"
    echo "  -h, --help        Muestra esta ayuda"
    echo "  -a, --all         Procesa todas las rutas"
    echo "  -r, --route ID    Procesa una ruta específica por ID"
    echo ""
    echo "Ejemplos:"
    echo "  ./run-snap-to-road.sh --all          Procesa todas las rutas"
    echo "  ./run-snap-to-road.sh --route 123    Procesa la ruta con ID 123"
}

# Sin argumentos, mostrar ayuda
if [ $# -eq 0 ]; then
    show_help
    exit 0
fi

# Procesar argumentos
case "$1" in
    -h|--help)
        show_help
        exit 0
        ;;
    -a|--all)
        echo "Procesando todas las rutas..."
        npx tsx scripts/snap-all-routes.ts
        ;;
    -r|--route)
        if [ -z "$2" ]; then
            echo "Error: Se requiere especificar un ID de ruta."
            show_help
            exit 1
        fi
        echo "Procesando ruta ID $2..."
        npx tsx scripts/fix-route-snap-to-road.ts "$2"
        ;;
    *)
        echo "Opción desconocida: $1"
        show_help
        exit 1
        ;;
esac

exit 0