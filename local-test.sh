#!/bin/bash

#######################################################################
# Local Testing Script for K8s Autoscaling Demo
# Supports Docker (or Podman) compose and Minikube.
# Will attempt to auto-run local setup scripts for Ubuntu/Fedora when
# missing required tools (asks for confirmation).
#
# Usage: bash local-test.sh [docker|minikube]
#######################################################################

set -e

MODE=${1:-docker}

echo "==========================================="
echo "   Local Testing Script"
echo "==========================================="
echo ""

command_exists() { command -v "$1" >/dev/null 2>&1; }

detect_container_engine() {
    CONTAINER_ENGINE=""
    COMPOSE_CMD=""
    if command_exists docker; then
        CONTAINER_ENGINE="docker"
        if docker compose version >/dev/null 2>&1; then
            COMPOSE_CMD="docker compose"
        elif command_exists docker-compose; then
            COMPOSE_CMD="docker-compose"
        fi
    elif command_exists podman; then
        CONTAINER_ENGINE="podman"
        if podman compose version >/dev/null 2>&1; then
            COMPOSE_CMD="podman compose"
        elif command_exists podman-compose; then
            COMPOSE_CMD="podman-compose"
        fi
    fi
}

detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_ID="$ID"
        OS_ID_LIKE="$ID_LIKE"
    else
        OS_ID="unknown"
        OS_ID_LIKE=""
    fi
}

run_local_setup() {
    # Determine which setup script to run based on distro
    detect_distro
    SCRIPT=""
    if [[ "$OS_ID" == "ubuntu" || "$OS_ID_LIKE" == *"debian"* || "$OS_ID" == "debian" ]]; then
        SCRIPT="local-setup-ubuntu.sh"
    elif [[ "$OS_ID" == "fedora" || "$OS_ID_LIKE" == *"fedora"* ]]; then
        SCRIPT="local-setup-fedora.sh"
    else
        # default to ubuntu script if unknown
        SCRIPT="local-setup-ubuntu.sh"
    fi

    if [ ! -x "./$SCRIPT" ]; then
        if [ -f "./$SCRIPT" ]; then
            chmod +x "./$SCRIPT"
        else
            echo "No local setup script found for your distro: $SCRIPT"
            echo "Please run the appropriate setup script manually."
            return 1
        fi
    fi

    echo "About to run $SCRIPT to install required local tooling. This requires sudo. Continue? [Y/n]"
    read -r REPLY
    REPLY=${REPLY:-Y}
    if [[ "$REPLY" =~ ^[Yy] ]]; then
        sudo bash "./$SCRIPT"
        return 0
    else
        echo "Skipping automated setup. Please install required tools and re-run this script."
        return 2
    fi
}

test_docker() {
    echo "Mode: Compose Testing"
    echo "-------------------------------------------"

    detect_container_engine

    if [ -z "$CONTAINER_ENGINE" ]; then
        echo "No container engine detected (docker or podman)."
        run_local_setup || exit 1
        detect_container_engine
    fi

    if [ -z "$COMPOSE_CMD" ]; then
        echo "No compose support detected for $CONTAINER_ENGINE."
        run_local_setup || exit 1
        detect_container_engine
    fi

    if [ -z "$CONTAINER_ENGINE" ] || [ -z "$COMPOSE_CMD" ]; then
        echo "Compose testing cannot proceed. Ensure Docker/Podman and compose are installed."
        exit 1
    fi

    echo "Using engine: $CONTAINER_ENGINE, compose command: $COMPOSE_CMD"

    echo "Step 1: Building image using: ${COMPOSE_CMD} build"
    eval ${COMPOSE_CMD} build

    echo "Step 2: Starting container(s)..."
    eval ${COMPOSE_CMD} up -d

    echo "Waiting for application to be ready..."
    sleep 5

    echo "Container status:"
    eval ${COMPOSE_CMD} ps

    echo "Testing health endpoint..."
    if command_exists curl; then
        curl -f http://localhost:3000/health || echo "Health check failed"
    fi

    echo "Application is running at http://localhost:3000"
    echo "To stop: ${COMPOSE_CMD} down"
}

test_minikube() {
    echo "Mode: Minikube Kubernetes Testing"
    echo "-------------------------------------------"

    # ensure tools
    if ! command_exists minikube || ! command_exists kubectl; then
        echo "Minikube or kubectl missing. Attempt automated setup?"
        run_local_setup || exit 1
    fi

    if ! command_exists minikube || ! command_exists kubectl; then
        echo "Required tools for Minikube are still missing. Aborting."
        exit 1
    fi

    detect_container_engine
    MINIKUBE_DRIVER="docker"
    if [ "$CONTAINER_ENGINE" = "podman" ]; then
        MINIKUBE_DRIVER="podman"
    fi

    echo "Starting Minikube with driver: $MINIKUBE_DRIVER"
    minikube start --driver=${MINIKUBE_DRIVER}
    minikube addons enable metrics-server

    echo "Building image inside Minikube..."
    eval $(minikube docker-env)
    docker build -t k8s-autoscaling-demo:latest .

    echo "Preparing k8s manifests for local image..."
    sed 's|YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest|k8s-autoscaling-demo:latest|g' k8s-app.yaml > k8s-app-local.yaml
    sed -i '/imagePullPolicy/d' k8s-app-local.yaml || true
    sed -i '/image: k8s-autoscaling-demo:latest/a\        imagePullPolicy: Never' k8s-app-local.yaml || true

    kubectl apply -f k8s-app-local.yaml
    kubectl apply -f k8s-hpa.yaml

    kubectl wait --for=condition=ready pod -l app=k8s-autoscaling --timeout=120s

    echo "Deployment status:"
    kubectl get deployments
    kubectl get pods
    kubectl get svc
    kubectl get hpa

    echo "Waiting for metrics to be available (about 60s)"
    sleep 60

    SERVICE_URL=$(minikube service k8s-autoscaling-service --url)
    echo "Application available at: $SERVICE_URL"
    echo "Generate load: for i in {1..20}; do curl $SERVICE_URL/stress & done"
}

case "$MODE" in
    docker)
        test_docker
        ;;
    minikube)
        test_minikube
        ;;
    *)
        echo "Usage: $0 [docker|minikube]"
        exit 1
        ;;
esac
#!/bin/bash

#######################################################################
# Local Testing Script for K8s Autoscaling Demo
# This script helps you test the application locally using:
# - Docker Compose for simple testing
# - Minikube for full Kubernetes testing with HPA
#
# Usage: bash local-test.sh [docker|minikube]
#######################################################################

set -e

test_docker() {
MODE=${1:-docker}

echo "==========================================="
echo "   Local Testing Script"
echo "==========================================="
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Detect container engine (docker or podman) and compose command
CONTAINER_ENGINE=""
COMPOSE_CMD=""
if command_exists docker; then
    CONTAINER_ENGINE="docker"
    # prefer `docker compose` if available, fall back to docker-compose
    if docker compose version >/dev/null 2>&1; then
        COMPOSE_CMD="docker compose"
    elif command_exists docker-compose; then
        COMPOSE_CMD="docker-compose"
    fi
elif command_exists podman; then
    CONTAINER_ENGINE="podman"
    # podman compose (modern) or podman-compose (python)
    if podman compose version >/dev/null 2>&1; then
        COMPOSE_CMD="podman compose"
    elif command_exists podman-compose; then
        COMPOSE_CMD="podman-compose"
    fi
fi

# Function to test with Docker/Podman Compose

    echo "Mode: Compose Testing (engine: ${CONTAINER_ENGINE:-none})"
    echo "-------------------------------------------"

    if [ -z "$CONTAINER_ENGINE" ]; then
        echo "Error: No container engine found (docker or podman)."
        echo "Install Docker or Podman, or run the Minikube mode instead."
        exit 1
    fi

    if [ -z "$COMPOSE_CMD" ]; then
        echo "Error: Compose support not found for ${CONTAINER_ENGINE}."
        if [ "$CONTAINER_ENGINE" = "docker" ]; then
            echo "Install Docker Compose: https://docs.docker.com/compose/install/"
        else
            echo "Install podman-compose or enable 'podman compose' support."
        fi
        exit 1
    fi

    echo ""
    echo "Step 1: Building image using: ${COMPOSE_CMD} build"
    eval ${COMPOSE_CMD} build

    echo ""
    echo "Step 2: Starting container(s)..."
    eval ${COMPOSE_CMD} up -d

    echo ""
    echo "Step 3: Waiting for application to be ready..."
    sleep 5

    echo ""
    echo "Step 4: Checking container status..."
    eval ${COMPOSE_CMD} ps

    echo ""
    echo "Step 5: Testing health endpoint..."
    if command_exists curl; then
        curl -f http://localhost:3000/health || echo "Health check failed"
    fi

    echo ""
    echo "==========================================="
    echo "Application is running!"
    echo "==========================================="
    echo ""
    echo "Access the application at: http://localhost:3000"
    echo ""
    echo "Test CPU stress at: http://localhost:3000/stress"
    echo ""
    echo "To view logs: ${COMPOSE_CMD} logs -f"
    echo "To stop: ${COMPOSE_CMD} down"
    echo ""
}
# Function to test with Minikube
test_minikube() {
    echo "Mode: Minikube Kubernetes Testing"
    echo "-------------------------------------------"
    
    # Check required tools
    if ! command_exists minikube; then
        echo "Error: Minikube is not installed"
        echo "Install from: https://minikube.sigs.k8s.io/docs/start/"
        exit 1
    fi
    
    if ! command_exists kubectl; then
        echo "Error: kubectl is not installed"
        echo "Install from: https://kubernetes.io/docs/tasks/tools/"
        exit 1
    fi
    
    echo ""
    echo "Step 1: Starting Minikube..."
    # Choose Minikube driver based on available container engine
    MINIKUBE_DRIVER="docker"
    if [ "$CONTAINER_ENGINE" = "podman" ]; then
        MINIKUBE_DRIVER="podman"
    fi
    minikube start --driver=${MINIKUBE_DRIVER}
    
    echo ""
    echo "Step 2: Enabling metrics-server addon..."
    minikube addons enable metrics-server
    
    echo ""
    echo "Step 3: Building Docker image in Minikube..."
    eval $(minikube docker-env)
    docker build -t k8s-autoscaling-demo:latest .
    
    echo ""
    echo "Step 4: Updating Kubernetes manifests for local testing..."
    # Create temporary manifests with local image
    sed 's|YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest|k8s-autoscaling-demo:latest|g' k8s-app.yaml > k8s-app-local.yaml
    sed -i '/imagePullPolicy/d' k8s-app-local.yaml
    sed -i '/image: k8s-autoscaling-demo:latest/a\        imagePullPolicy: Never' k8s-app-local.yaml
    
    echo ""
    echo "Step 5: Deploying application to Minikube..."
    kubectl apply -f k8s-app-local.yaml
    kubectl apply -f k8s-hpa.yaml
    
    echo ""
    echo "Step 6: Waiting for pods to be ready..."
    kubectl wait --for=condition=ready pod -l app=k8s-autoscaling --timeout=120s
    
    echo ""
    echo "Step 7: Checking deployment status..."
    kubectl get deployments
    kubectl get pods
    kubectl get svc
    kubectl get hpa
    
    echo ""
    echo "Step 8: Waiting for metrics to be available..."
    echo "This may take 1-2 minutes..."
    sleep 60
    
    echo ""
    echo "==========================================="
    echo "Application deployed to Minikube!"
    echo "==========================================="
    echo ""
    
    # Get the service URL
    SERVICE_URL=$(minikube service k8s-autoscaling-service --url)
    echo "Access the application at: $SERVICE_URL"
    echo ""
    echo "Or run: minikube service k8s-autoscaling-service"
    echo ""
    echo "--- Monitoring Commands ---"
    echo "Watch HPA: watch kubectl get hpa"
    echo "Watch Pods: watch kubectl get pods"
    echo "View Metrics: kubectl top pods"
    echo ""
    echo "--- Generate Load for Autoscaling Test ---"
    echo "for i in {1..20}; do curl $SERVICE_URL/stress & done"
    echo ""
    echo "--- Cleanup ---"
    echo "kubectl delete -f k8s-hpa.yaml"
    echo "kubectl delete -f k8s-app-local.yaml"
    echo "rm k8s-app-local.yaml"
    echo "minikube stop"
    echo ""
}

# Main logic
case "$MODE" in
    docker)
        test_docker
        ;;
    minikube)
        test_minikube
        ;;
    *)
        echo "Usage: $0 [docker|minikube]"
        echo ""
        echo "Modes:"
        echo "  docker   - Test with Docker Compose (simple, no autoscaling)"
        echo "  minikube - Test with Minikube (full K8s with HPA)"
        echo ""
        exit 1
        ;;
esac
