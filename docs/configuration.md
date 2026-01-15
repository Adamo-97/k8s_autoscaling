# Configuration Reference

This document provides detailed explanations of all configuration files used in the Kubernetes Autoscaling Demo project.

---

## Table of Contents

1. [Dockerfile](#dockerfile)
2. [Docker Compose](#docker-compose)
3. [Kubernetes Manifests](#kubernetes-manifests)
4. [Automation Scripts](#automation-scripts)

---

## Dockerfile

The project uses a multi-stage Docker build to optimize image size and security.

**File:** [Dockerfile](../Dockerfile)

```dockerfile
# Build stage - Compiles TypeScript to JavaScript
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# Production stage - Minimal runtime image
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY --from=builder /app/dist ./dist

# Security: Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "dist/server.js"]
```

### Key Features

- **Two-Stage Build:** Reduces final image size by excluding development dependencies and source code
- **Alpine Base:** Uses minimal Alpine Linux for security and efficiency
- **Non-Root User:** Runs as user ID 1001 to prevent privilege escalation
- **Health Check:** Enables Kubernetes liveness/readiness probes
- **Production Dependencies Only:** Final stage contains only runtime dependencies

---

## Docker Compose

For local testing without Kubernetes overhead.

**File:** [docker-compose.yml](../docker-compose.yml)

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

**Purpose:** Provides quick local validation before cloud deployment. No HPA functionality, but confirms application logic works correctly.

---

## Kubernetes Manifests

### Application Deployment and Service

**File:** [k8s-app.yaml](../k8s-app.yaml)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: k8s-autoscaling-app
spec:
  replicas: 1 # Initial replica count (HPA will modify this)
  template:
    spec:
      containers:
        - name: app
          image: adamabd97/k8s-autoscaling-demo:latest
          ports:
            - containerPort: 3000
          resources:
            requests:
              cpu: 100m # Guaranteed CPU allocation
              memory: 128Mi # Guaranteed memory allocation
            limits:
              cpu: 500m # Maximum CPU allowed
              memory: 256Mi # Maximum memory allowed
          livenessProbe: # Restart container if unhealthy
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe: # Remove from service if not ready
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: k8s-autoscaling-service
spec:
  type: NodePort
  ports:
    - port: 80 # Service internal port
      targetPort: 3000 # Container port
      nodePort: 30080 # External access port on all nodes
  selector:
    app: k8s-autoscaling
```

### Critical Configuration Details

- **Resource Requests:** Used by HPA to calculate CPU utilization percentage
  - Formula: `currentUtilization = (actualCPU / requestedCPU) * 100`
  - Example: If pod uses 50m CPU, utilization = (50m / 100m) \* 100 = 50%
- **Resource Limits:** Prevents runaway processes from consuming all node resources
- **Probes:** Liveness restarts failed containers; readiness manages traffic routing
- **NodePort 30080:** Allows external access on `http://<NODE_IP>:30080`

### Horizontal Pod Autoscaler

**File:** [k8s-hpa.yaml](../k8s-hpa.yaml)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: k8s-autoscaling-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: k8s-autoscaling-app
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50 # Target 50% CPU across all pods
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0 # Scale up immediately
      policies:
        - type: Percent
          value: 100 # Double replicas per 15s
          periodSeconds: 15
        - type: Pods
          value: 2 # OR add 2 pods per 15s
          periodSeconds: 15
      selectPolicy: Max # Use whichever adds more pods
    scaleDown:
      stabilizationWindowSeconds: 60 # Wait 60s before scaling down
      policies:
        - type: Percent
          value: 50 # Remove 50% of pods per 15s
          periodSeconds: 15
        - type: Pods
          value: 1 # OR remove 1 pod per 15s
          periodSeconds: 15
      selectPolicy: Min # Use whichever removes fewer pods
```

### Scaling Logic Explanation

- **Target 50% CPU:** HPA tries to maintain average CPU at 50% by adjusting replica count
- **Scale-Up Aggressive:** No delay, doubles pods or adds 2 (whichever is more)
- **Scale-Down Conservative:** Waits 60s, removes slowly to prevent flapping
- **Desired Replicas Calculation:**
  ```
  desiredReplicas = ceil(currentReplicas * (currentCPU / targetCPU))
  Example: ceil(2 * (75% / 50%)) = ceil(3) = 3 replicas
  ```

### RBAC Permissions

**File:** [k8s-rbac.yaml](../k8s-rbac.yaml)

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: dashboard-sa
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: dashboard-role
rules:
  - apiGroups: [""]
    resources: ["pods", "services"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["autoscaling"]
    resources: ["horizontalpodautoscalers"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: dashboard-rb
subjects:
  - kind: ServiceAccount
    name: dashboard-sa
roleRef:
  kind: Role
  name: dashboard-role
```

**Purpose:** Grants the application pods read-only access to cluster resources for displaying real-time dashboard data. Without these permissions, the `/cluster-status` endpoint would fail with authorization errors.

---

## Automation Scripts

### setup_aws_node.sh

**Purpose:** Automates complete node setup on AWS EC2 Ubuntu 22.04 instances.

**What It Does:**

1. Disables swap memory (required by Kubernetes)
2. Loads kernel modules (overlay, br_netfilter)
3. Configures sysctl networking parameters
4. Installs containerd runtime
5. Configures containerd with SystemdCgroup
6. Installs kubeadm, kubelet, kubectl v1.28
7. Prevents automatic package upgrades

**Usage:**

```bash
sudo bash setup_aws_node.sh
```

**Execution Time:** Approximately 2-3 minutes per node

### local-setup-ubuntu.sh

**Purpose:** Installs local development tools on Ubuntu workstations.

**What It Does:**

1. Installs Docker Engine and Docker Compose plugin
2. Installs kubectl for cluster management
3. Installs Minikube for local Kubernetes testing
4. Configures conntrack (required by CNI plugins)

**Usage:**

```bash
sudo bash local-setup-ubuntu.sh
```

### local-setup-fedora.sh

**Purpose:** Installs local development tools on Fedora workstations.

**What It Does:**

1. Installs Podman (Docker alternative) and podman-docker compatibility layer
2. Installs podman-compose
3. Installs kubectl and Minikube
4. Configures conntrack

**Usage:**

```bash
sudo bash local-setup-fedora.sh
```

### local-test.sh

**Purpose:** Comprehensive local testing with Docker Compose or Minikube.

**What It Does:**

1. Auto-detects container engine (Docker/Podman)
2. Auto-detects Linux distribution
3. Offers to run appropriate setup script if tools missing
4. Tests application with Docker Compose (basic validation)
5. Tests application with Minikube (full HPA validation)

**Usage:**

```bash
bash local-test.sh docker    # Docker Compose test
bash local-test.sh minikube  # Minikube test with HPA
```

### load-generator.sh

**Purpose:** Generates HTTP load to trigger HPA autoscaling.

**What It Does:**

1. Sends concurrent HTTP requests to `/cpu-load` endpoint
2. Measures response times
3. Configurable request count and concurrency

**Usage:**

```bash
bash load-generator.sh http://NODE_IP:30080 100 10   # 100 requests, 10 concurrent
bash load-generator.sh http://NODE_IP:30080 200 20   # Heavy load
```

### deploy_infra.sh

**Purpose:** Automates complete AWS infrastructure deployment.

**What It Does:**

1. Validates AWS CLI and credentials
2. Creates SSH key pair
3. Creates and configures security group
4. Launches EC2 instances with user data
5. Waits for instances to be ready
6. Displays connection instructions

**Usage:**

```bash
bash deploy_infra.sh
bash deploy_infra.sh --region us-west-2 --instance-type t3.large
```

### teardown_infra.sh

**Purpose:** Safely destroys all AWS resources.

**What It Does:**

1. Terminates EC2 instances
2. Waits for complete termination
3. Deletes security group
4. Deletes SSH key pair
5. Removes local .pem file

**Usage:**

```bash
bash teardown_infra.sh
```

---

## Environment Variables

### Application Configuration

| Variable   | Default       | Description      |
| ---------- | ------------- | ---------------- |
| `NODE_ENV` | `development` | Environment mode |
| `PORT`     | `3000`        | HTTP server port |

### Phased Test Configuration

These are configured in `src/config/index.ts`:

| Setting           | Default | Description                        |
| ----------------- | ------- | ---------------------------------- |
| `WARM_UP_MS`      | 30000   | Warm-up phase duration (30s)       |
| `RAMP_UP_MS`      | 60000   | Ramp-up phase duration (60s)       |
| `STEADY_MS`       | 60000   | Steady state duration (60s)        |
| `RAMP_DOWN_MS`    | 60000   | Ramp-down phase duration (60s)     |
| `INTENSITY_STEPS` | 10      | Number of intensity levels         |
| `TEST_ITERATIONS` | 10      | Number of iterations in test suite |

---

## References

- [Kubernetes Official Documentation](https://kubernetes.io/docs/)
- [kubeadm Installation Guide](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/)
- [Horizontal Pod Autoscaler Walkthrough](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/)
- [Calico Documentation](https://docs.tigera.io/calico/latest/about/)
- [containerd Configuration](https://github.com/containerd/containerd/blob/main/docs/cri/config.md)
- [AWS EC2 Instance Types](https://aws.amazon.com/ec2/instance-types/)
- [Metrics Server](https://github.com/kubernetes-sigs/metrics-server)
