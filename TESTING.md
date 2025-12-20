# Complete Testing Guide - K8s Autoscaling Project

## Project Summary
This project demonstrates **Horizontal Pod Autoscaling (HPA)** on a self-managed Kubernetes cluster running on AWS EC2 instances. It satisfies Project Option 3 requirements for the Cloud Computing course.

---

## What You Need to Show in Your Presentation

1. ✅ **Architecture**: Self-managed K8s cluster on EC2 (not EKS)
2. ✅ **Application**: Dockerized web application with CPU-intensive endpoint
3. ✅ **Autoscaling**: HPA configured to scale 1-10 replicas based on CPU
4. ✅ **Scale Out**: Demonstrate pods increasing under load
5. ✅ **Scale In**: Demonstrate pods decreasing when load stops
6. ✅ **Metrics**: Show CPU usage, pod counts, HPA decisions

---

## Testing Locally (Before AWS Deployment)

### Prerequisites
- Linux machine (Ubuntu/Fedora)
- Podman or Docker installed
- Minikube and kubectl installed

### Quick Start

#### Option 1: Test with Compose (Fastest - No K8s)
```bash
# Build and run with Docker Compose or Podman Compose
bash local-test.sh docker

# Access dashboard
open http://localhost:3000

# Test stress endpoint
curl http://localhost:3000/stress
```

#### Option 2: Test with Minikube (Full K8s + HPA)
```bash
# Start Minikube cluster (DO NOT use sudo)
bash local-test.sh minikube

# Get the service URL
SERVICE_URL=$(minikube service k8s-autoscaling-service --url)

# Access the dashboard
open $SERVICE_URL
```

**Important**: If Minikube fails with Podman, manually run:
```bash
minikube delete
minikube start --driver=podman
minikube addons enable metrics-server
```

### Testing Autoscaling Locally

1. **Deploy to Minikube** (if not already done):
   ```bash
   eval $(minikube docker-env)
   docker build -t k8s-autoscaling-demo:latest .
   
   # Modify k8s-app.yaml to use local image
   sed 's|YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest|k8s-autoscaling-demo:latest|g' k8s-app.yaml > k8s-app-local.yaml
   echo "        imagePullPolicy: Never" >> k8s-app-local.yaml
   
   kubectl apply -f k8s-app-local.yaml
   kubectl apply -f k8s-hpa.yaml
   ```

2. **Generate Load**:
   ```bash
   SERVICE_URL=$(minikube service k8s-autoscaling-service --url)
   bash load-generator.sh $SERVICE_URL 100 20
   ```

3. **Monitor Scaling** (in separate terminals):
   ```bash
   # Terminal 1: Watch HPA
   watch kubectl get hpa
   
   # Terminal 2: Watch pods
   watch kubectl get pods
   
   # Terminal 3: Watch CPU usage
   watch kubectl top pods
   ```

4. **Expected Behavior**:
   - Initial: 1 pod running
   - After load: CPU rises above 50%
   - HPA scales up: 2-10 pods created
   - After ~30-60s of no load: Pods scale down to 1

---

## AWS EC2 Deployment (For Presentation)

### Phase 1: Prepare Docker Image

```bash
# Build and push to Docker Hub
docker build -t YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest .
docker login
docker push YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest
```

Update `k8s-app.yaml` line 21:
```yaml
image: YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest
```

### Phase 2: Launch EC2 Instances

**Minimum Configuration** (for a good demo):
- **Instances**: 3x EC2 (1 master + 2 workers)
- **Type**: t3.medium (2 vCPU, 4 GB RAM)
- **OS**: Ubuntu 22.04 LTS
- **Storage**: 20 GB gp3

**Security Group Rules**:
| Type | Port | Source | Purpose |
|------|------|--------|---------|
| SSH | 22 | Your IP | Management |
| Custom TCP | 6443 | Security Group ID | K8s API |
| Custom TCP | 30080 | 0.0.0.0/0 | NodePort (app access) |
| Custom TCP | 2379-2380 | Security Group ID | etcd |
| Custom TCP | 10250-10252 | Security Group ID | kubelet/scheduler |

### Phase 3: Setup Kubernetes Cluster

1. **Run setup on ALL nodes**:
   ```bash
   # Copy script to each node
   scp -i key.pem setup_aws_node.sh ubuntu@NODE_IP:~/
   
   # SSH and run on each node
   ssh -i key.pem ubuntu@NODE_IP
   sudo bash setup_aws_node.sh
   ```

2. **Initialize master node**:
   ```bash
   # On master only
   sudo kubeadm init --pod-network-cidr=192.168.0.0/16
   
   mkdir -p $HOME/.kube
   sudo cp /etc/kubernetes/admin.conf $HOME/.kube/config
   sudo chown $(id -u):$(id -g) $HOME/.kube/config
   
   # Install Calico CNI
   kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.26.1/manifests/calico.yaml
   ```

3. **Join worker nodes**:
   ```bash
   # On each worker (use join command from kubeadm init output)
   sudo kubeadm join MASTER_IP:6443 --token TOKEN --discovery-token-ca-cert-hash sha256:HASH
   ```

4. **Install Metrics Server** (REQUIRED for HPA):
   ```bash
   # On master
   wget https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
   sed -i '/- args:/a\        - --kubelet-insecure-tls' components.yaml
   kubectl apply -f components.yaml
   
   # Wait ~60s then verify
   kubectl top nodes
   ```

### Phase 4: Deploy Application

```bash
# On master node
kubectl apply -f k8s-app.yaml
kubectl apply -f k8s-hpa.yaml

# Verify
kubectl get deployments
kubectl get pods
kubectl get svc
kubectl get hpa
```

### Phase 5: Access & Test

1. **Access the dashboard**:
   ```bash
   # Get any node's public IP
   NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="ExternalIP")].address}')
   echo "Dashboard: http://$NODE_IP:30080"
   ```

2. **Generate load**:
   ```bash
   # From your local machine or master node
   bash load-generator.sh http://NODE_IP:30080 200 20
   ```

3. **Monitor autoscaling**:
   ```bash
   # Terminal 1
   watch kubectl get hpa
   
   # Terminal 2
   watch kubectl get pods
   
   # Terminal 3
   watch kubectl top pods
   ```

---

## What to Show in Your Presentation

### 1. Architecture (5 min)
- Show AWS Console: 3 EC2 instances running
- Show cluster status: `kubectl get nodes`
- Explain HPA configuration: `cat k8s-hpa.yaml`

### 2. Baseline State (2 min)
- Dashboard view showing 1 pod
- HPA status: `kubectl get hpa`
- Current CPU: `kubectl top pods`

### 3. Scale Out Demo (4 min)
- Run load generator: `bash load-generator.sh http://NODE_IP:30080 200 20`
- Show real-time dashboard (pod cards appearing)
- Terminal showing HPA scaling: `watch kubectl get hpa`
- Terminal showing pods increasing: `watch kubectl get pods`
- Explain: CPU > 50% → HPA creates more pods

### 4. Scale In Demo (3 min)
- Stop load generator
- Show CPU dropping
- Show HPA reducing replicas after cooldown (~5 min)
- Pods terminating back to minimum (1)

### 5. Key Metrics (1 min)
- Final HPA status
- Total scale events
- Min/Max replicas achieved
- Response times under load

---

## Troubleshooting

### HPA shows `<unknown>` for CPU
```bash
# Check metrics-server
kubectl get deployment metrics-server -n kube-system
kubectl logs -n kube-system deployment/metrics-server

# Verify metrics are available
kubectl top nodes
kubectl top pods
```

### Pods not scaling
```bash
# Check HPA events
kubectl describe hpa k8s-autoscaling-hpa

# Verify resource requests are set
kubectl get deployment k8s-autoscaling -o yaml | grep -A 5 resources
```

### Can't access NodePort service
- Verify Security Group allows port 30080
- Check service: `kubectl get svc`
- Test from master node: `curl http://localhost:30080`

---

## Cleanup

### Local (Minikube)
```bash
kubectl delete -f k8s-hpa.yaml
kubectl delete -f k8s-app-local.yaml
minikube stop
minikube delete
```

### AWS
```bash
# On master
kubectl delete -f k8s-hpa.yaml
kubectl delete -f k8s-app.yaml

# Terminate EC2 instances via AWS Console
```

---

## Performance Expectations

| Metric | Expected Value |
|--------|---------------|
| Initial replicas | 1 |
| Max replicas under load | 8-10 (depends on load intensity) |
| Scale-up time | 30-60 seconds |
| Scale-down time | 5-10 minutes (default cooldown) |
| CPU target | 50% |
| Stress endpoint duration | 30 seconds |

---

## Files You Need

- ✅ `src/server.ts` - Application with dashboard and /stress endpoint
- ✅ `Dockerfile` - Multi-stage build
- ✅ `k8s-app.yaml` - Deployment + NodePort Service
- ✅ `k8s-hpa.yaml` - HPA configuration (1-10 replicas, 50% CPU)
- ✅ `setup_aws_node.sh` - Automated node setup (containerd, kubeadm, etc.)
- ✅ `load-generator.sh` - Script to generate HTTP load
- ✅ `local-test.sh` - Local testing automation
- ✅ `README.md` - Complete documentation
- ✅ `TESTING.md` - This file

---

## Tips for a Great Presentation

1. **Practice the demo** on Minikube first
2. **Take screenshots** of each scaling phase
3. **Prepare backup slides** with screenshots in case live demo fails
4. **Explain decisions**: Why t3.medium? Why 50% CPU? Why 30s stress duration?
5. **Show code**: Highlight the `/stress` endpoint in `server.ts`
6. **Show configs**: Walk through `k8s-hpa.yaml` line by line
7. **Monitor in real-time**: Use `watch` commands in multiple terminals
8. **Time the demo**: 15 min total - leave time for questions

Good luck with your presentation!
