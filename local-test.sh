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

MODE=${1:-docker}

echo "==========================================="
echo "   Local Testing Script"
echo "==========================================="
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to test with Docker Compose
test_docker() {
    echo "Mode: Docker Compose Testing"
    echo "-------------------------------------------"
    
    # Check Docker
    if ! command_exists docker; then
        echo "Error: Docker is not installed"
        echo "Install from: https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    if ! command_exists docker-compose && ! docker compose version >/dev/null 2>&1; then
        echo "Error: Docker Compose is not installed"
        echo "Install from: https://docs.docker.com/compose/install/"
        exit 1
    fi
    
    echo ""
    echo "Step 1: Building Docker image..."
    docker-compose build
    
    echo ""
    echo "Step 2: Starting container..."
    docker-compose up -d
    
    echo ""
    echo "Step 3: Waiting for application to be ready..."
    sleep 5
    
    echo ""
    echo "Step 4: Checking container status..."
    docker-compose ps
    
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
    echo "To view logs: docker-compose logs -f"
    echo "To stop: docker-compose down"
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
    minikube start --driver=docker
    
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
