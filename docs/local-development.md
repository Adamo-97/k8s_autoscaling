# Local Development Guide

This guide covers local development and testing workflows for the Kubernetes Autoscaling Demo project.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Docker Compose Testing](#docker-compose-testing)
3. [Minikube Testing](#minikube-testing)
4. [Automated Local Testing](#automated-local-testing)
5. [Development Workflow](#development-workflow)

---

## Prerequisites

### Required Tools

| Tool          | Purpose                             | Installation                                       |
| ------------- | ----------------------------------- | -------------------------------------------------- |
| Docker/Podman | Container runtime                   | `local-setup-ubuntu.sh` or `local-setup-fedora.sh` |
| Node.js 20+   | TypeScript compilation and runtime  | https://nodejs.org/                                |
| kubectl       | Kubernetes CLI                      | Included in setup scripts                          |
| Minikube      | Local Kubernetes cluster (optional) | Included in setup scripts                          |

### Setup Scripts

**Ubuntu/Debian:**

```bash
sudo bash local-setup-ubuntu.sh
```

**Fedora/RHEL:**

```bash
sudo bash local-setup-fedora.sh
```

These scripts install:

- Docker Engine (Ubuntu) or Podman (Fedora)
- Docker Compose / podman-compose
- kubectl CLI
- Minikube
- conntrack (required by CNI plugins)

---

## Docker Compose Testing

Docker Compose provides quick validation of the application container without Kubernetes overhead. **Note:** This mode does not test HPA functionality.

### Basic Usage

```bash
# Start the application
docker compose up --build -d

# Verify the application is running
curl http://localhost:3000/health

# Expected response:
# {"status":"healthy","pod":"<container-id>","timestamp":"..."}

# Test the CPU load endpoint
curl http://localhost:3000/cpu-load

# Access the dashboard
# Open http://localhost:3000 in a web browser

# View logs
docker compose logs -f

# Cleanup
docker compose down
```

### Docker Compose Configuration

The [docker-compose.yml](../docker-compose.yml) file defines:

```yaml
version: "3.8"
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    image: k8s-autoscaling-demo:local
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    restart: unless-stopped
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "require('http').get('http://localhost:3000/health', ...)",
        ]
      interval: 30s
      timeout: 3s
```

---

## Minikube Testing

Minikube provides a complete HPA demonstration in a local Kubernetes environment.

### Starting Minikube

```bash
# Start Minikube with sufficient resources
minikube start --driver=docker --cpus=2 --memory=4096

# Enable the metrics-server addon (required for HPA)
minikube addons enable metrics-server
```

### Building and Deploying

```bash
# Build the application image within Minikube's Docker context
eval $(minikube docker-env)
docker build -t k8s-autoscaling-demo:latest .

# Use the local manifest (pre-configured for Minikube)
kubectl apply -f k8s-rbac.yaml
kubectl apply -f k8s-app-local.yaml
kubectl apply -f k8s-hpa.yaml

# Wait for pods to be ready
kubectl wait --for=condition=ready pod -l app=k8s-autoscaling --timeout=120s
```

### Accessing the Application

```bash
# Get the service URL
minikube service k8s-autoscaling-demo-service --url

# Or use port forwarding
kubectl port-forward svc/k8s-autoscaling-demo-service 3000:80
```

### Monitoring HPA

```bash
# Monitor HPA and pods in real-time
watch -n 1 kubectl get hpa,pods

# View detailed HPA status
kubectl describe hpa k8s-autoscaling-hpa
```

### Generating Load

```bash
# Get the service URL
SERVICE_URL=$(minikube service k8s-autoscaling-demo-service --url)

# Generate load to trigger scaling
for i in $(seq 1 50); do
    curl -s "${SERVICE_URL}/cpu-load" &
    sleep 0.5
done

# Or use the load generator script
bash load-generator.sh $SERVICE_URL 150 15
```

### Cleanup

```bash
# Delete Kubernetes resources
kubectl delete -f k8s-hpa.yaml
kubectl delete -f k8s-app-local.yaml
kubectl delete -f k8s-rbac.yaml

# Stop Minikube
minikube stop

# Delete Minikube cluster (optional)
minikube delete
```

---

## Automated Local Testing

The project includes an automated testing script that handles tool detection and setup.

### Usage

```bash
# Run Docker Compose test (recommended for quick validation)
bash local-test.sh docker

# Run Minikube test (full HPA validation)
bash local-test.sh minikube
```

### Auto-Setup Feature

If Docker or Minikube is not installed, the script will:

1. Detect your Linux distribution (Ubuntu/Fedora)
2. Offer to run the appropriate setup script
3. Proceed with testing after setup completes

---

## Development Workflow

### TypeScript Development

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Run production build locally
npm start
```

### Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run with coverage
npm run test:coverage

# Run integration tests
npm run test:ci
```

### Docker Build

```bash
# Build production image
docker build -t k8s-autoscaling-demo:latest .

# Build with custom tag
docker build -t YOUR_USERNAME/k8s-autoscaling-demo:v1.0.0 .

# Test the built image
docker run -p 3000:3000 k8s-autoscaling-demo:latest
```

### Code Structure

```
src/
├── index.ts              # Application entry point
├── app.ts                # Express routes and middleware
├── server.ts             # HTTP server setup
├── config/
│   └── index.ts          # Configuration management
├── services/
│   ├── kubernetes.service.ts  # K8s API interactions
│   └── stress.service.ts      # CPU stress generation
├── templates/
│   └── dashboard.ts      # Dashboard HTML generation
└── utils/
    └── kubernetes.ts     # K8s utility functions
```

### Environment Variables

| Variable   | Default       | Description      |
| ---------- | ------------- | ---------------- |
| `NODE_ENV` | `development` | Environment mode |
| `PORT`     | `3000`        | HTTP server port |

---

## Troubleshooting

### Docker Issues

**"Cannot connect to Docker daemon":**

```bash
# Start Docker service
sudo systemctl start docker

# Add user to docker group (logout required)
sudo usermod -aG docker $USER
```

**"Port 3000 already in use":**

```bash
# Find process using port
lsof -i :3000

# Kill the process or use different port
docker compose up -p 3001:3000
```

### Minikube Issues

**"Minikube won't start":**

```bash
# Check driver compatibility
minikube start --driver=docker

# Reset Minikube
minikube delete
minikube start
```

**"Metrics server not ready":**

```bash
# Wait for metrics server
kubectl -n kube-system wait --for=condition=ready pod -l k8s-app=metrics-server --timeout=120s

# Check metrics server logs
kubectl -n kube-system logs -l k8s-app=metrics-server
```

### HPA Issues

**"HPA shows <unknown> for CPU":**

- Metrics Server is not running or not ready
- Wait 30-60 seconds after enabling metrics-server addon
- Verify with: `kubectl top pods`

**"Pods not scaling":**

- Check HPA events: `kubectl describe hpa k8s-autoscaling-hpa`
- Ensure pods have CPU requests defined in deployment
- Verify metrics are being collected: `kubectl top pods`

---

## Next Steps

- [AWS Deployment Guide](aws-deployment.md) - Deploy to production
- [Architecture Reference](architecture.md) - Understand the system design
- [Troubleshooting Guide](troubleshooting.md) - Resolve common issues
