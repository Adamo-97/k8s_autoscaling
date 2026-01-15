# Kubernetes Autoscaling on AWS EC2

**A Manual Implementation of Horizontal Pod Autoscaling in a Self-Managed Kubernetes Cluster**

[![Docker Image](https://img.shields.io/docker/v/adamabd97/k8s-autoscaling-demo?label=Docker%20Hub)](https://hub.docker.com/r/adamabd97/k8s-autoscaling-demo)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Overview

This project demonstrates Horizontal Pod Autoscaling (HPA) on a self-managed Kubernetes cluster deployed on AWS EC2. It deliberately bypasses AWS EKS to provide hands-on exposure to fundamental Kubernetes components.

**Key Features:**

- Manual 3-node Kubernetes cluster (1 control plane + 2 workers)
- Real-time dashboard with pod metrics and scaling visualization
- HPA with aggressive scale-up (0s stabilization) and conservative scale-down (60s)
- 4-phase load testing pattern (Warm-up → Ramp-up → Steady → Ramp-down)
- 10-iteration test suite with result aggregation

---

## Quick Start

### Prerequisites

```bash
# Verify Docker and AWS CLI
docker --version && docker login
aws --version && aws sts get-caller-identity
```

### Deploy to AWS (5 Steps)

#### Step 1: Build and Push Docker Image

```bash
docker build -t YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest .
docker push YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest

# Update manifest with your username
sed -i 's|adamabd97/k8s-autoscaling-demo|YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo|g' k8s-app.yaml
```

#### Step 2: Deploy AWS Infrastructure

```bash
bash deploy_infra.sh
# Creates: 3 EC2 instances, security group, SSH key pair
# Wait 3-5 minutes for Kubernetes components to install
```

#### Step 3: Initialize Kubernetes Cluster

```bash
# SSH to control plane
ssh -i k8s-autoscaling-demo-key.pem ubuntu@<CONTROL_PLANE_IP>

# Initialize cluster
sudo kubeadm init --pod-network-cidr=192.168.0.0/16

# Configure kubectl
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# Install Calico CNI
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.26.1/manifests/calico.yaml
```

#### Step 4: Join Worker Nodes

```bash
# SSH to each worker and run the join command from kubeadm init output
sudo kubeadm join <CONTROL_PLANE_IP>:6443 --token <TOKEN> --discovery-token-ca-cert-hash sha256:<HASH>
```

#### Step 5: Deploy Application

```bash
# Install Metrics Server (required for HPA)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl -n kube-system patch deployment metrics-server --type='json' -p='[
  {"op":"replace","path":"/spec/template/spec/containers/0/args","value":["--cert-dir=/tmp","--secure-port=443","--kubelet-insecure-tls","--kubelet-preferred-address-types=InternalIP"]}
]'

# Clone repo and deploy
git clone https://github.com/Adamo-97/k8s_autoscaling.git && cd k8s_autoscaling
kubectl apply -f k8s-rbac.yaml
kubectl apply -f k8s-app.yaml
kubectl apply -f k8s-hpa.yaml

# Access dashboard
echo "Dashboard: http://<ANY_NODE_IP>:30080"
```

### Test Autoscaling

1. Open dashboard at `http://<NODE_IP>:30080`
2. Click **"Quick Load"** for instant CPU stress or **"Start Phased Test"** for 4-phase pattern
3. Watch HPA scale pods from 1 → 10 replicas
4. Monitor with: `watch -n 1 kubectl get hpa,pods`

### Cleanup

```bash
bash teardown_infra.sh  # Destroys all AWS resources
```

**Cost:** ~$0.15/hour for 3x t3.medium instances. **Always run teardown after testing!**

---

## Local Development

### Docker Compose (Quick Test)

```bash
docker compose up --build -d
curl http://localhost:3000/health
# Open http://localhost:3000
docker compose down
```

### Minikube (Full HPA Test)

```bash
bash local-test.sh minikube
```

### Run Tests

```bash
npm install
npm test                 # All tests
npm run test:unit        # Unit tests only
npm run test:coverage    # With coverage report
```

---

## Project Structure

```
k8s_autoscaling/
├── src/                    # TypeScript application source
│   ├── app.ts              # Express routes and handlers
│   ├── server.ts           # HTTP server setup
│   ├── services/           # Business logic (kubernetes, stress)
│   └── templates/          # Dashboard HTML generation
├── tests/                  # Jest test suites
├── docs/                   # Detailed documentation
├── aws/                    # AWS deployment helper scripts
├── k8s-*.yaml              # Kubernetes manifests
├── deploy_infra.sh         # Automated AWS deployment
├── teardown_infra.sh       # AWS cleanup script
├── local-test.sh           # Local testing automation
└── Dockerfile              # Multi-stage container build
```

---

## Documentation

| Document                                       | Description                                                  |
| ---------------------------------------------- | ------------------------------------------------------------ |
| [Architecture](docs/architecture.md)           | System diagrams, HPA decision loop, AWS infrastructure       |
| [Local Development](docs/local-development.md) | Docker Compose, Minikube, development workflow               |
| [AWS Deployment](docs/aws-deployment.md)       | Full deployment guide, CLI commands, verification            |
| [Configuration](docs/configuration.md)         | Manifest explanations, script details, environment variables |
| [Troubleshooting](docs/troubleshooting.md)     | Common issues and solutions                                  |
| [Full Reference](docs/README-full.md)          | Complete original documentation                              |

---

## Testing Features

### 4-Phase Load Test Pattern

The phased test follows proper stress testing methodology:

| Phase     | Duration | Behavior                              |
| --------- | -------- | ------------------------------------- |
| Warm-up   | 30s      | Light load, system preparation        |
| Ramp-up   | 60s      | Gradual intensity increase (10 steps) |
| Steady    | 60s      | Maximum sustained load                |
| Ramp-down | 60s      | Gradual intensity decrease            |

### 10-Iteration Test Suite

Run multiple test iterations with automatic result aggregation:

- Average scale-up time
- Average scale-down time
- Average peak replicas
- Success/failure tracking

Access via dashboard or API:

```bash
curl -X POST http://<NODE_IP>:30080/run-test-suite
curl http://<NODE_IP>:30080/test-suite-results
```

---

## API Endpoints

| Endpoint              | Method | Description                  |
| --------------------- | ------ | ---------------------------- |
| `/`                   | GET    | Dashboard UI                 |
| `/health`             | GET    | Health check                 |
| `/cpu-load`           | GET    | Quick CPU stress             |
| `/generate-load`      | POST   | Distributed load across pods |
| `/cluster-status`     | GET    | SSE stream of pod/HPA status |
| `/phased-load`        | POST   | Start 4-phase load test      |
| `/phased-test-status` | GET    | SSE stream of test progress  |
| `/run-test-suite`     | POST   | Start 10-iteration suite     |
| `/test-suite-status`  | GET    | Suite progress               |
| `/test-suite-results` | GET    | Aggregated results           |

---

## Tech Stack

- **Runtime:** Node.js 20, TypeScript, Express.js
- **Container:** Docker multi-stage build, Alpine Linux
- **Orchestration:** Kubernetes 1.28, kubeadm, containerd
- **Networking:** Calico CNI, NodePort services
- **Cloud:** AWS EC2 (t3.medium), gp3 SSD
- **Testing:** Jest, Supertest

---

## License

MIT License - See [LICENSE](LICENSE) for details.

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `npm test`
4. Submit a pull request

---

## Author

[Adamo-97](https://github.com/Adamo-97)
