# Quick Start Guide

## Local Testing (Before AWS Deployment)

### Option 1: Docker Compose (Fastest - No Autoscaling)

```bash
# Test the application with Docker Compose
bash local-test.sh docker

# Access: http://localhost:3000
# Stop: docker-compose down
```

### Option 2: Minikube (Full K8s with Autoscaling)

```bash
# Full Kubernetes testing with HPA
bash local-test.sh minikube

# Generate load to test autoscaling
SERVICE_URL=$(minikube service k8s-autoscaling-service --url)
for i in {1..20}; do curl $SERVICE_URL/stress & done

# Monitor in separate terminals
watch kubectl get hpa
watch kubectl get pods

# Cleanup
kubectl delete -f k8s-hpa.yaml
kubectl delete -f k8s-app-local.yaml
rm k8s-app-local.yaml
minikube stop
```

### Option 3: Manual Node.js Testing

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run application
npm start

# Test endpoints
curl http://localhost:3000
curl http://localhost:3000/health
curl http://localhost:3000/stress
```

## Push to Docker Hub

```bash
# Replace YOUR_DOCKERHUB_USERNAME with your actual username
docker build -t YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest .
docker login
docker push YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest
```

## AWS Deployment

After local testing succeeds, follow the README.md Phase 2 for AWS EC2 deployment.

### Quick AWS Summary

1. Launch 3x Ubuntu 22.04 EC2 instances (t3.medium)
2. Copy and run setup_aws_node.sh on all nodes
3. Initialize master: `kubeadm init --pod-network-cidr=192.168.0.0/16`
4. Install Calico CNI
5. Join worker nodes
6. Install Metrics Server
7. Deploy application: `kubectl apply -f k8s-app.yaml -f k8s-hpa.yaml`
8. Access: `http://<NODE_IP>:30080`

## Monitoring Commands

```bash
# Watch HPA status
watch kubectl get hpa

# Watch pods
watch kubectl get pods

# Check metrics
kubectl top nodes
kubectl top pods

# View HPA details
kubectl describe hpa k8s-autoscaling-hpa

# View logs
kubectl logs -f <POD_NAME>
```

## Troubleshooting

### Metrics Server Not Working
```bash
kubectl rollout restart deployment metrics-server -n kube-system
```

### Docker Build Issues
```bash
# Clean Docker cache
docker system prune -a
```

### Minikube Issues
```bash
# Reset Minikube
minikube delete
minikube start --driver=docker
```
