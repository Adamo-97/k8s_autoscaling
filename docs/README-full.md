# Kubernetes Autoscaling on AWS EC2

**A Manual Implementation of Horizontal Pod Autoscaling in a Self-Managed Kubernetes Cluster**

---

## Table of Contents

1. [Project Abstract](#1-project-abstract)
2. [Technical Glossary](#2-technical-glossary)
3. [Architecture Diagrams](#3-architecture-diagrams)
   - [3.1 System Architecture](#31-system-architecture)
   - [3.2 Deployment Workflow](#32-deployment-workflow)
   - [3.3 HPA Decision Loop](#33-hpa-decision-loop)
   - [3.4 Network Communication Flow](#34-network-communication-flow)
4. [Project Code Explanation](#4-project-code-explanation)
   - [4.1 Dockerfile Configuration](#41-dockerfile-configuration)
   - [4.2 Docker Compose Configuration](#42-docker-compose-configuration)
   - [4.3 Kubernetes Manifests](#43-kubernetes-manifests)
   - [4.4 Automation Scripts](#44-automation-scripts)
5. [Prerequisites and Infrastructure Requirements](#5-prerequisites-and-infrastructure-requirements)
   - [5.1 Required Tools](#51-required-tools)
   - [5.2 AWS Infrastructure Requirements](#52-aws-infrastructure-requirements)
   - [5.3 Complete Port and Configuration Reference](#53-complete-port-and-configuration-reference)
6. [Implementation Guide](#6-implementation-guide)
   - [6.1 Phase 1: Local Verification](#61-phase-1-local-verification)
   - [6.2 Phase 2: AWS Production Deployment with Automated Scripts](#62-phase-2-aws-production-deployment-with-automated-scripts)
7. [Verification and Monitoring](#7-verification-and-monitoring)
   - [7.1 Presentation Dashboard Split-Screen Method](#71-presentation-dashboard-split-screen-method)
   - [7.2 Critical Metrics for Autoscaling Validation](#72-critical-metrics-for-autoscaling-validation)
8. [Cost Management and Cleanup](#8-cost-management-and-cleanup)
9. [Troubleshooting Reference](#9-troubleshooting-reference)
10. [References and Further Reading](#10-references-and-further-reading)

---

## Quick Start Guide

**Complete deployment in 5 steps from your local machine:**

### Prerequisites Check

```bash
# 1. Ensure you have Docker installed and DockerHub account
docker --version
docker login

# 2. Verify AWS CLI is configured
aws --version
aws sts get-caller-identity  # Should show your AWS account info
```

### Step-by-Step Deployment Process

#### Step 1: Build and Push Docker Image (Run Locally)

```bash
# Navigate to project directory
cd /path/to/k8s_autoscaling

# Build the image (replace YOUR_DOCKERHUB_USERNAME)
docker build -t YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest .

# Push to DockerHub (makes it accessible to AWS instances)
docker push YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest
```

**Important:** Update [k8s-app.yaml](k8s-app.yaml#L17) line 17 to use your DockerHub username:

```yaml
image: YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest
```

#### Step 2: Deploy AWS Infrastructure (Run Locally - No SSH Needed Yet)

```bash
# This script runs entirely from your local machine
# It will create EC2 instances, security groups, and SSH keys automatically
bash deploy_infra.sh
```

**What happens:**

- Validates AWS CLI and credentials
- Creates SSH key pair (saves `k8s-autoscaling-demo-key.pem` locally)
- Creates security group with firewall rules
- Launches 3 EC2 instances (1 control + 2 workers)
- Waits 3-5 minutes for instances to install Kubernetes components
- Displays instance IPs and next steps

**Output:** You'll see instance IPs like:

```
Control Plane IP: 54.123.45.67
Worker 1 IP:      54.123.45.68
Worker 2 IP:      54.123.45.69
```

**You do NOT need to be connected via SSH** - the script creates everything remotely.

#### Step 3: Initialize Kubernetes Cluster (SSH to Control Plane)

Now SSH into the control plane instance:

```bash
# The .pem key was created by deploy_infra.sh
chmod 400 k8s-autoscaling-demo-key.pem
ssh -i k8s-autoscaling-demo-key.pem ubuntu@<CONTROL_PLANE_IP>
```

Once connected, initialize the cluster:

```bash
# Run on control plane node
sudo kubeadm init --pod-network-cidr=192.168.0.0/16

# Configure kubectl access
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# Install Calico CNI (required for pod networking)
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.26.1/manifests/calico.yaml

# Wait for all system pods to be Ready
kubectl get pods -n kube-system --watch
# Press Ctrl+C when all pods show "Running" and "1/1" or "2/2"
```

**Save the join command** that `kubeadm init` outputs - looks like:

```bash
kubeadm join 172.31.x.x:6443 --token abc123... --discovery-token-ca-cert-hash sha256:def456...
```

#### Step 4: Join Worker Nodes (SSH to Each Worker)

Open new terminal windows and SSH to each worker:

```bash
# Terminal 2: Worker 1
ssh -i k8s-autoscaling-demo-key.pem ubuntu@<WORKER_1_IP>
sudo <PASTE_JOIN_COMMAND_HERE>

# Terminal 3: Worker 2
ssh -i k8s-autoscaling-demo-key.pem ubuntu@<WORKER_2_IP>
sudo <PASTE_JOIN_COMMAND_HERE>
```

Verify nodes joined (back on control plane):

```bash
kubectl get nodes
# Should show 3 nodes in "Ready" state
```

#### Step 5: Deploy Application (On Control Plane)

```bash
# Clone the repo on the control plane (or copy manifests manually)
git clone https://github.com/Adamo-97/k8s_autoscaling.git
cd k8s_autoscaling

# Deploy application, RBAC, and HPA
kubectl apply -f k8s-rbac.yaml
kubectl apply -f k8s-app.yaml
kubectl apply -f k8s-hpa.yaml

# Verify deployment
kubectl get pods
kubectl get hpa

# Get the NodePort (should be 30080)
kubectl get svc k8s-autoscaling-demo-service
```
#### Step 5a: Install and Configure Metrics Server (Required for HPA)

The Horizontal Pod Autoscaler requires metrics-server to collect CPU/memory metrics. Self-managed clusters need additional configuration due to self-signed kubelet certificates.

**Install metrics-server:**

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

**Configure for self-managed clusters (fix kubelet TLS and cert-dir issues):**

```bash
# Clean any failed pods and prepare for patch
kubectl -n kube-system scale deployment metrics-server --replicas=0
kubectl -n kube-system delete rs -l k8s-app=metrics-server --ignore-not-found
kubectl -n kube-system delete pod -l k8s-app=metrics-server --ignore-not-found

# Wait for cleanup
sleep 3

# Patch with lab-compatible configuration (atomic replace to avoid duplicate ports)
kubectl -n kube-system patch deployment metrics-server --type='json' -p='[
  {"op":"replace","path":"/spec/template/spec/containers/0/ports","value":[{"containerPort":443,"name":"https","protocol":"TCP"}]},
  {"op":"replace","path":"/spec/template/spec/containers/0/args","value":["--cert-dir=/tmp","--secure-port=443","--kubelet-insecure-tls","--kubelet-preferred-address-types=InternalIP"]}
]'

# Scale back up and wait for rollout
kubectl -n kube-system scale deployment metrics-server --replicas=1
kubectl -n kube-system rollout status deployment/metrics-server --timeout=3m
```

**Verify metrics are working:**

```bash
# Check metrics-server pod is Running/Ready
kubectl get pods -n kube-system -l k8s-app=metrics-server

# Expected output:
# NAME                              READY   STATUS    RESTARTS   AGE
# metrics-server-77f555d89b-xxxxx   1/1     Running   0          60s

# View node metrics
kubectl top nodes

# Expected output:
# NAME              CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
# ip-172-31-7-48    250m         12%    512Mi           25%

# View HPA metrics (should show numeric % instead of <unknown>)
kubectl get hpa

# Expected output:
# NAME                  REFERENCE                        TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
# k8s-autoscaling-hpa   Deployment/k8s-autoscaling-app   1%/50%    1         10        1          5m
```

**Troubleshooting:**

If HPA still shows `<unknown>/50%` or `kubectl top` returns `Metrics API not available`:

```bash
# Check metrics-server logs for errors
kubectl -n kube-system logs -l k8s-app=metrics-server --tail=100

# Check APIService registration
kubectl get apiservice v1beta1.metrics.k8s.io

# If APIService shows "False" status, wait 30s and retry kubectl top commands
```

**Note:** The `--kubelet-insecure-tls` flag is for development/lab clusters only. For production, configure kubelet serving certificates with proper IP SANs or use a valid CA.

**Access the dashboard:**

```
http://<ANY_NODE_PUBLIC_IP>:30080
```

### About the Docker Image

**Automatic Fetching:** Yes! Once you push the image to DockerHub in Step 1, Kubernetes automatically pulls it when you run `kubectl apply -f k8s-app.yaml`. The manifest specifies:

```yaml
spec:
  containers:
    - name: k8s-autoscaling-demo
      image: YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest # Kubernetes pulls from here
      imagePullPolicy: Always # Forces fresh pull on every deployment
```

No manual docker pull needed on worker nodes - Kubernetes handles it.

### Testing the Autoscaler

1. Open dashboard: `http://<NODE_IP>:30080`
2. Click "Start CPU Load" button
3. Watch HPA scale pods from 1 → 10 replicas
4. Observe real-time pod creation in dashboard

### Managing Kubernetes Resources

**Delete stuck or problematic pods:**

```bash
# SSH to control plane node
ssh -i k8s-autoscaling-demo-key.pem ubuntu@<CONTROL_PLANE_IP>

# List all app pods
kubectl get pods -l app=k8s-autoscaling

# Delete a specific stuck pod (it will be recreated automatically by the Deployment)
kubectl delete pod <POD_NAME>

# Example:
kubectl delete pod k8s-autoscaling-app-5d54b8bbf6-k2jjz
```

**Redeploy application with updated code/image:**

```bash
# 1. Build and push new image (run locally)
docker build -t YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest .
docker push YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest

# 2. Restart deployment (on control plane)
kubectl rollout restart deployment/k8s-autoscaling-app
kubectl rollout status deployment/k8s-autoscaling-app

# Verify new pods are running
kubectl get pods -l app=k8s-autoscaling
```

**Remove application deployment completely:**

```bash
# SSH to control plane node
ssh -i k8s-autoscaling-demo-key.pem ubuntu@<CONTROL_PLANE_IP>

# Delete all application resources
kubectl delete -f k8s-app.yaml
kubectl delete -f k8s-hpa.yaml

# Optional: Remove metrics-server
kubectl delete -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.8.0/components.yaml

# Verify removal
kubectl get deployments
kubectl get hpa
kubectl get pods -l app=k8s-autoscaling
```

**Note:** Use the commands above for iterative development. Use `teardown_infra.sh` only when you're completely done and want to destroy all AWS infrastructure.

### Cleanup After Testing

```bash
# Run from your local machine (not SSH)
bash teardown_infra.sh

# This removes:
# - All EC2 instances
# - Security group
# - SSH key pair
# - Local .pem file
```

**Cost:** ~$0.15/hour for 3x t3.medium instances. **Always run teardown after testing!**

---

## 1. Project Abstract

This project provides a comprehensive implementation of a self-managed Kubernetes cluster deployed on Amazon Web Services (AWS) Elastic Compute Cloud (EC2) infrastructure. The primary objective is to demonstrate the operational mechanics of Horizontal Pod Autoscaling (HPA) in response to CPU-based workload stress.

**Key Differentiator:** This implementation deliberately bypasses AWS Elastic Kubernetes Service (EKS) to provide practitioners with hands-on exposure to the fundamental components of Kubernetes cluster administration. By manually configuring the control plane, worker nodes, container runtime, and networking layer, users gain deeper insight into the interdependencies that managed services typically abstract.

**Scope of Demonstration:**

- Manual provisioning of a three-node Kubernetes cluster (one control plane, two worker nodes)
- Configuration of the Container Runtime Interface (CRI) using containerd
- Deployment of the Calico Container Network Interface (CNI) plugin
- Installation and configuration of the Metrics Server for resource monitoring
- Implementation of HPA policies with defined scaling thresholds
- Validation of autoscaling behavior under synthetic CPU load

**Educational Outcomes:**
Upon completion, practitioners will possess the technical competency to deploy, configure, and troubleshoot Kubernetes clusters in environments where managed services are unavailable or cost-prohibitive.

---

## 2. Technical Glossary

The following table provides definitions for key technical terms used throughout this documentation. These definitions are intentionally simplified to facilitate understanding for readers with varying levels of expertise.

| Term                                  | Definition                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **NodePort**                          | A Kubernetes Service type that exposes an application on a static port (range 30000-32767) on every node in the cluster. External traffic can reach the application by connecting to any node's IP address on the designated port.                                                                     |
| **Horizontal Pod Autoscaler (HPA)**   | A Kubernetes controller that automatically adjusts the number of pod replicas in a deployment based on observed metrics (typically CPU or memory utilization). The HPA increases replicas when demand rises and decreases them when demand falls.                                                      |
| **Kubelet**                           | The primary node agent that runs on every worker node in the cluster. It ensures that containers described in PodSpecs are running and healthy. The kubelet communicates with the control plane to receive instructions and report node status.                                                        |
| **CNI (Container Network Interface)** | A specification and set of libraries for configuring network interfaces in Linux containers. In Kubernetes, CNI plugins (such as Calico, Flannel, or Weave) provide pod-to-pod networking across nodes.                                                                                                |
| **SystemdCgroup**                     | A configuration option for container runtimes that delegates cgroup (control group) management to systemd rather than the container runtime itself. This ensures consistency with how Kubernetes manages resource allocation and is required when using systemd as the init system.                    |
| **Swap Memory**                       | A portion of disk storage used as virtual memory when physical RAM is exhausted. Kubernetes requires swap to be disabled because the scheduler assumes predictable memory availability; swap introduces latency and unpredictable performance that conflicts with Quality of Service (QoS) guarantees. |
| **Metrics Server**                    | A cluster-wide aggregator of resource usage data. It collects CPU and memory metrics from kubelets and exposes them through the Kubernetes API. The HPA relies on Metrics Server data to make scaling decisions.                                                                                       |
| **Control Plane**                     | The set of components that manage the overall state of the cluster, including the API server, scheduler, controller manager, and etcd. The control plane makes global decisions about the cluster and detects and responds to cluster events.                                                          |
| **etcd**                              | A distributed key-value store that serves as the backing store for all Kubernetes cluster data. It stores configuration data, state, and metadata that the control plane requires to function.                                                                                                         |
| **Calico**                            | A CNI plugin that provides networking and network policy enforcement for Kubernetes. It uses BGP (Border Gateway Protocol) to route traffic between nodes without encapsulation, offering high performance.                                                                                            |

---

## 3. Architecture Diagrams

The following diagrams are rendered using Mermaid.js syntax. They illustrate the system architecture, deployment workflow, and scaling feedback mechanisms.

### 3.1 System Architecture

This diagram depicts the flow of user requests through the Kubernetes cluster and the feedback loop that enables autoscaling.

```mermaid
flowchart TB
    subgraph External["External Network"]
        User["User Browser/Client"]
    end

    subgraph AWS["AWS EC2 Infrastructure"]
        subgraph Master["Control Plane Node (t3.medium)"]
            API["kube-apiserver"]
            Scheduler["kube-scheduler"]
            CM["kube-controller-manager"]
            ETCD["etcd"]
            HPA["HPA Controller"]
            MS["Metrics Server"]
        end

        subgraph Workers["Worker Nodes (t3.medium x2)"]
            subgraph Worker1["Worker Node 1"]
                K1["kubelet"]
                P1["Pod Replica 1"]
                P2["Pod Replica 2"]
            end
            subgraph Worker2["Worker Node 2"]
                K2["kubelet"]
                P3["Pod Replica 3"]
                P4["Pod Replica N"]
            end
        end

        SVC["NodePort Service\nPort 30080"]
    end

    User -->|"HTTP Request\nPort 30080"| SVC
    SVC -->|"Load Distribution"| P1
    SVC -->|"Load Distribution"| P2
    SVC -->|"Load Distribution"| P3
    SVC -->|"Load Distribution"| P4

    K1 -->|"Report Metrics"| MS
    K2 -->|"Report Metrics"| MS
    MS -->|"Expose Metrics API"| HPA
    HPA -->|"Query Current Usage"| MS
    HPA -->|"Scale Decision"| API
    API -->|"Create/Delete Pods"| Scheduler
    Scheduler -->|"Assign Pods"| K1
    Scheduler -->|"Assign Pods"| K2
```

### 3.2 Deployment Workflow

This sequence diagram illustrates the complete deployment pipeline from local development to production operation.

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Developer Workstation
    participant Docker as Docker Hub Registry
    participant AWS as AWS Console
    participant Master as Control Plane Node
    participant Worker as Worker Nodes
    participant K8s as Kubernetes API

    rect rgb(240, 248, 255)
        Note over Dev,Docker: Phase 1 - Build and Registry
        Dev->>Dev: npm run build (TypeScript compilation)
        Dev->>Dev: docker build -t image:tag .
        Dev->>Dev: docker run (local validation)
        Dev->>Docker: docker push image:tag
    end

    rect rgb(255, 248, 240)
        Note over AWS,Worker: Phase 2 - Infrastructure Provisioning
        Dev->>AWS: Launch 3x EC2 t3.medium instances
        Dev->>AWS: Configure Security Groups
        AWS->>Master: Provision Control Plane
        AWS->>Worker: Provision Worker Nodes
    end

    rect rgb(240, 255, 240)
        Note over Master,K8s: Phase 3 - Cluster Initialization
        Dev->>Master: SSH and execute setup_aws_node.sh
        Dev->>Worker: SSH and execute setup_aws_node.sh
        Master->>Master: kubeadm init
        Master->>Master: Install Calico CNI
        Master->>Master: Install Metrics Server
        Worker->>Master: kubeadm join
        Master->>K8s: Cluster Ready
    end

    rect rgb(248, 240, 255)
        Note over K8s,K8s: Phase 4 - Application Deployment
        Dev->>K8s: kubectl apply -f k8s-app.yaml
        Dev->>K8s: kubectl apply -f k8s-hpa.yaml
        K8s->>K8s: Deploy initial replica
        K8s->>K8s: HPA monitoring active
    end
```

### 3.3 HPA Decision Loop

This diagram illustrates the continuous feedback loop that governs autoscaling decisions.

```mermaid
flowchart LR
    subgraph Monitoring["Metrics Collection (Every 15s)"]
        MS["Metrics Server"]
        K["Kubelet"]
    end

    subgraph Decision["HPA Controller"]
        Calc["Calculate:\ndesiredReplicas = ceil(currentReplicas * (currentMetric / targetMetric))"]
        Compare["Compare with\nmin/max bounds"]
    end

    subgraph Action["Scaling Action"]
        Scale["Update Deployment\nreplica count"]
        Wait["Stabilization\nWindow"]
    end

    K -->|"CPU/Memory\nUsage Data"| MS
    MS -->|"Aggregated\nMetrics"| Calc
    Calc --> Compare
    Compare -->|"Scale Up"| Scale
    Compare -->|"Scale Down"| Wait
    Wait -->|"After cooldown"| Scale
    Scale -->|"New pods\nreport metrics"| K
```

### 3.4 Network Communication Flow

This diagram details the network ports and protocols required for cluster communication.

```mermaid
flowchart TB
    subgraph External["External Traffic"]
        Client["Client"]
    end

    subgraph ControlPlane["Control Plane Ports"]
        API6443["API Server\n:6443/TCP"]
        ETCD2379["etcd\n:2379-2380/TCP"]
        Sched10259["Scheduler\n:10259/TCP"]
        CM10257["Controller Manager\n:10257/TCP"]
    end

    subgraph WorkerPorts["Worker Node Ports"]
        Kubelet10250["Kubelet\n:10250/TCP"]
        NodePort["NodePort Range\n:30000-32767/TCP"]
    end

    subgraph CNIPorts["CNI (Calico) Ports"]
        BGP179["BGP\n:179/TCP"]
        VXLAN4789["VXLAN\n:4789/UDP"]
    end

    Client -->|"Application Traffic"| NodePort
    API6443 <-->|"Cluster Management"| Kubelet10250
    API6443 <-->|"State Storage"| ETCD2379
    Kubelet10250 <-->|"Pod Networking"| BGP179
    Kubelet10250 <-->|"Overlay Network"| VXLAN4789
```

### 3.5 AWS Infrastructure Architecture

This diagram illustrates the AWS resources created by `deploy_infra.sh` and how security group rules control access.

```mermaid
flowchart TB
    subgraph Internet["Internet"]
        User["Your Workstation<br/>IP: xxx.xxx.xxx.xxx"]
        PublicUsers["Public Users<br/>(Dashboard Access)"]
    end

    subgraph AWS["AWS Cloud - Region: us-east-1"]
        subgraph SecurityGroup["Security Group: k8s-autoscaling-demo-sg"]
            direction TB
            SG_Rules["Security Group Rules:<br/>━━━━━━━━━━━━━━━━━<br/>✓ SSH (22) ← Your IP/32<br/>✓ NodePort (30080) ← 0.0.0.0/0<br/>✓ All Traffic ← Self-Reference"]
        end

        subgraph VPC["Default VPC"]
            subgraph Subnet["Default Subnet"]
                EC2_1["EC2 Instance 1<br/>t3.medium<br/>━━━━━━━━━━━<br/>Public IP: 54.x.x.1<br/>Private IP: 172.31.x.1<br/>Role: Control Plane<br/>━━━━━━━━━━━<br/>Components:<br/>• kubeadm/kubelet<br/>• containerd<br/>• Calico CNI"]
                EC2_2["EC2 Instance 2<br/>t3.medium<br/>━━━━━━━━━━━<br/>Public IP: 54.x.x.2<br/>Private IP: 172.31.x.2<br/>Role: Worker Node<br/>━━━━━━━━━━━<br/>Components:<br/>• kubelet<br/>• containerd<br/>• Application Pods"]
                EC2_3["EC2 Instance 3<br/>t3.medium<br/>━━━━━━━━━━━<br/>Public IP: 54.x.x.3<br/>Private IP: 172.31.x.3<br/>Role: Worker Node<br/>━━━━━━━━━━━<br/>Components:<br/>• kubelet<br/>• containerd<br/>• Application Pods"]
            end
        end

        KeyPair["SSH Key Pair<br/>k8s-autoscaling-demo-key<br/>━━━━━━━━━━━<br/>Private Key: .pem file<br/>(stored locally)"]
    end

    subgraph LocalMachine["Local Machine"]
        KeyFile["k8s-autoscaling-demo-key.pem<br/>(chmod 400)"]
        DeployScript["deploy_infra.sh"]
        TeardownScript["teardown_infra.sh"]
    end

    %% Security Group Connections
    User -->|"SSH (Port 22)"| SG_Rules
    PublicUsers -->|"HTTP (Port 30080)"| SG_Rules

    SG_Rules -.->|"Protects"| EC2_1
    SG_Rules -.->|"Protects"| EC2_2
    SG_Rules -.->|"Protects"| EC2_3

    %% Internal Communication (Self-Reference Rule)
    EC2_1 <-->|"Kubernetes API (6443)<br/>etcd (2379-2380)<br/>kubelet (10250)<br/>Calico BGP (179)"| EC2_2
    EC2_1 <-->|"All Cluster Traffic"| EC2_3
    EC2_2 <-->|"Pod-to-Pod Traffic"| EC2_3

    %% Key Pair Usage
    KeyPair -.->|"Authenticates"| EC2_1
    KeyPair -.->|"Authenticates"| EC2_2
    KeyPair -.->|"Authenticates"| EC2_3
    KeyFile -.->|"Corresponds to"| KeyPair

    %% Script Actions
    DeployScript -->|"Creates"| SecurityGroup
    DeployScript -->|"Creates"| KeyPair
    DeployScript -->|"Launches"| EC2_1
    DeployScript -->|"Launches"| EC2_2
    DeployScript -->|"Launches"| EC2_3

    TeardownScript -.->|"Terminates"| EC2_1
    TeardownScript -.->|"Terminates"| EC2_2
    TeardownScript -.->|"Terminates"| EC2_3
    TeardownScript -.->|"Deletes"| SecurityGroup
    TeardownScript -.->|"Deletes"| KeyPair

    classDef awsResource fill:#FF9900,stroke:#232F3E,stroke-width:2px,color:#232F3E
    classDef securityResource fill:#DD344C,stroke:#232F3E,stroke-width:2px,color:#fff
    classDef localResource fill:#4A90E2,stroke:#232F3E,stroke-width:2px,color:#fff

    class EC2_1,EC2_2,EC2_3 awsResource
    class SecurityGroup,SG_Rules,KeyPair securityResource
    class DeployScript,TeardownScript,KeyFile localResource
```

**Key Infrastructure Components:**

1. **Security Group** (`k8s-autoscaling-demo-sg`):

   - Acts as a virtual firewall for all instances
   - Three types of rules:
     - **SSH (22)**: Restricted to your public IP for administrative access
     - **NodePort (30080)**: Open to the internet for dashboard access
     - **Self-Reference**: Allows all traffic between instances (enables Kubernetes cluster communication)

2. **EC2 Instances** (3x t3.medium):

   - Each instance has public IP (for external access) and private IP (for internal communication)
   - All instances share the same security group
   - User data script automatically installs Kubernetes components on first boot

3. **SSH Key Pair** (`k8s-autoscaling-demo-key`):

   - Created by `deploy_infra.sh` and saved locally as `.pem` file
   - Used to authenticate SSH connections to all instances
   - Private key never leaves your local machine

4. **Internal Communication**:

   - Self-referencing security group rule enables all instances to communicate freely
   - Required for Kubernetes control plane communication (API server, etcd, kubelet)
   - Required for pod networking via Calico CNI

5. **Deployment Scripts**:
   - `deploy_infra.sh`: Creates all AWS resources in correct order
   - `teardown_infra.sh`: Safely destroys all resources to prevent charges

**Security Model:**

- **External Access**: Only SSH (from your IP) and NodePort 30080 (public) are exposed
- **Internal Access**: All ports open between cluster nodes for Kubernetes operation
- **Authentication**: SSH key pair required for terminal access
- **Isolation**: VPC and security group provide network isolation from other AWS resources

---

## 4. Project Code Explanation

This section provides detailed explanations of all configuration files and scripts used in the project. Understanding these components is essential for successful deployment and troubleshooting.

### 4.1 Dockerfile Configuration

The project uses a multi-stage Docker build to optimize image size and security.

**File:** [Dockerfile](Dockerfile)

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

**Key Features:**

- **Two-Stage Build:** Reduces final image size by excluding development dependencies and source code
- **Alpine Base:** Uses minimal Alpine Linux for security and efficiency
- **Non-Root User:** Runs as user ID 1001 to prevent privilege escalation
- **Health Check:** Enables Kubernetes liveness/readiness probes
- **Production Dependencies Only:** Final stage contains only runtime dependencies

### 4.2 Docker Compose Configuration

For local testing without Kubernetes overhead.

**File:** [docker-compose.yml](docker-compose.yml)

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

### 4.3 Kubernetes Manifests

#### 4.3.1 Application Deployment and Service

**File:** [k8s-app.yaml](k8s-app.yaml)

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

**Critical Configuration Details:**

- **Resource Requests:** Used by HPA to calculate CPU utilization percentage
  - Formula: `currentUtilization = (actualCPU / requestedCPU) * 100`
  - Example: If pod uses 50m CPU, utilization = (50m / 100m) \* 100 = 50%
- **Resource Limits:** Prevents runaway processes from consuming all node resources
- **Probes:** Liveness restarts failed containers; readiness manages traffic routing
- **NodePort 30080:** Allows external access on `http://<NODE_IP>:30080`

#### 4.3.2 Horizontal Pod Autoscaler

**File:** [k8s-hpa.yaml](k8s-hpa.yaml)

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

**Scaling Logic Explanation:**

- **Target 50% CPU:** HPA tries to maintain average CPU at 50% by adjusting replica count
- **Scale-Up Aggressive:** No delay, doubles pods or adds 2 (whichever is more)
- **Scale-Down Conservative:** Waits 60s, removes slowly to prevent flapping
- **Desired Replicas Calculation:**
  ```
  desiredReplicas = ceil(currentReplicas * (currentCPU / targetCPU))
  Example: ceil(2 * (75% / 50%)) = ceil(3) = 3 replicas
  ```

#### 4.3.3 RBAC Permissions

**File:** [k8s-rbac.yaml](k8s-rbac.yaml)

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

### 4.4 Automation Scripts

#### 4.4.1 setup_aws_node.sh

**Purpose:** Automates complete node setup on AWS EC2 Ubuntu 22.04 instances.

**File:** [setup_aws_node.sh](setup_aws_node.sh)

**What It Does:**

1. Disables swap memory (required by Kubernetes)
2. Loads kernel modules (overlay, br_netfilter)
3. Configures sysctl networking parameters
4. Installs containerd runtime
5. Configures containerd with SystemdCgroup
6. Installs kubeadm, kubelet, kubectl v1.28
7. Prevents automatic package upgrades

**Usage on AWS:**

```bash
# On each EC2 node (control plane and workers)
sudo bash setup_aws_node.sh
```

**Execution Time:** Approximately 2-3 minutes per node

#### 4.4.2 local-setup-ubuntu.sh

**Purpose:** Installs local development tools on Ubuntu workstations.

**File:** [local-setup-ubuntu.sh](local-setup-ubuntu.sh)

**What It Does:**

1. Installs Docker Engine and Docker Compose plugin
2. Installs kubectl for cluster management
3. Installs Minikube for local Kubernetes testing
4. Configures conntrack (required by CNI plugins)

**Usage:**

```bash
sudo bash local-setup-ubuntu.sh
```

#### 4.4.3 local-setup-fedora.sh

**Purpose:** Installs local development tools on Fedora workstations.

**File:** [local-setup-fedora.sh](local-setup-fedora.sh)

**What It Does:**

1. Installs Podman (Docker alternative) and podman-docker compatibility layer
2. Installs podman-compose
3. Installs kubectl and Minikube
4. Configures conntrack

**Usage:**

```bash
sudo bash local-setup-fedora.sh
```

#### 4.4.4 local-test.sh

**Purpose:** Comprehensive local testing with Docker Compose or Minikube.

**File:** [local-test.sh](local-test.sh)

**What It Does:**

1. Auto-detects container engine (Docker/Podman)
2. Auto-detects Linux distribution
3. Offers to run appropriate setup script if tools missing
4. Tests application with Docker Compose (basic validation)
5. Tests application with Minikube (full HPA validation)

**Usage:**

```bash
# Docker Compose test
bash local-test.sh docker

# Minikube test with HPA
bash local-test.sh minikube
```

#### 4.4.5 load-generator.sh

**Purpose:** Generates HTTP load to trigger HPA autoscaling.

**File:** [load-generator.sh](load-generator.sh)

**What It Does:**

1. Sends concurrent HTTP requests to `/cpu-load` endpoint
2. Measures response times
3. Configurable request count and concurrency

**Usage:**

```bash
# Basic usage (100 requests, 10 concurrent)
bash load-generator.sh http://NODE_IP:30080

# Custom load (200 requests, 20 concurrent)
bash load-generator.sh http://NODE_IP:30080 200 20

# Minikube
bash load-generator.sh $(minikube service k8s-autoscaling-service --url) 150 15
```

**Expected Behavior:** After 30-60 seconds of sustained load, HPA should increase replica count.

---

## 5. Prerequisites and Infrastructure Requirements

### 5.1 Required Tools

The following software must be installed on the developer workstation prior to beginning implementation:

| Tool       | Minimum Version | Purpose                                              |
| ---------- | --------------- | ---------------------------------------------------- |
| Docker     | 20.10+          | Container image building and local testing           |
| kubectl    | 1.28+           | Kubernetes cluster management                        |
| AWS CLI    | 2.0+            | AWS resource provisioning (optional but recommended) |
| SSH Client | Any             | Remote access to EC2 instances                       |
| Git        | 2.0+            | Repository cloning and version control               |
| Node.js    | 20.0+           | Application runtime (for local development)          |

**Installation Verification Commands:**

```bash
docker --version
kubectl version --client
aws --version
ssh -V
git --version
node --version
```

### 5.2 AWS Infrastructure Requirements

#### Critical Instance Type Requirement

**WARNING:** The Kubernetes control plane requires a minimum of 2 vCPUs to function correctly. The `kubeadm init` command will fail on instances with fewer than 2 vCPUs.

| Instance Type | vCPUs | Memory | Suitability                |
| ------------- | ----- | ------ | -------------------------- |
| t2.micro      | 1     | 1 GB   | NOT SUITABLE - Will fail   |
| t2.small      | 1     | 2 GB   | NOT SUITABLE - Will fail   |
| t3.medium     | 2     | 4 GB   | MINIMUM RECOMMENDED        |
| t3.large      | 2     | 8 GB   | Recommended for production |

**Technical Rationale:** The control plane components (API server, scheduler, controller manager, etcd) are CPU-intensive processes that require concurrent execution. Single-vCPU instances cannot provide the parallel processing capacity needed for cluster orchestration.

#### Required EC2 Instances

| Node Role     | Count | Instance Type | Storage   | Operating System |
| ------------- | ----- | ------------- | --------- | ---------------- |
| Control Plane | 1     | t3.medium     | 20 GB gp3 | Ubuntu 22.04 LTS |
| Worker        | 2     | t3.medium     | 20 GB gp3 | Ubuntu 22.04 LTS |

#### Security Group Configuration

Create a security group with the following inbound rules. Pay particular attention to the self-referencing rule that enables internal cluster communication.

| Rule Name          | Type       | Protocol | Port Range  | Source                   | Purpose                     |
| ------------------ | ---------- | -------- | ----------- | ------------------------ | --------------------------- |
| SSH Access         | SSH        | TCP      | 22          | Your IP/32               | Administrative access       |
| Kubernetes API     | Custom TCP | TCP      | 6443        | Security Group ID (self) | Control plane communication |
| etcd Server        | Custom TCP | TCP      | 2379-2380   | Security Group ID (self) | Cluster state storage       |
| Kubelet API        | Custom TCP | TCP      | 10250       | Security Group ID (self) | Node agent communication    |
| Kube-Scheduler     | Custom TCP | TCP      | 10259       | Security Group ID (self) | Pod scheduling              |
| Controller Manager | Custom TCP | TCP      | 10257       | Security Group ID (self) | Cluster controllers         |
| NodePort Services  | Custom TCP | TCP      | 30000-32767 | 0.0.0.0/0                | External application access |
| Calico BGP         | Custom TCP | TCP      | 179         | Security Group ID (self) | CNI routing                 |
| Calico VXLAN       | Custom UDP | UDP      | 4789        | Security Group ID (self) | CNI overlay network         |

**Technical Rationale for Self-Referencing Rules:** When a security group references itself as a source, it permits all instances within that security group to communicate with each other on the specified ports. This is essential because Kubernetes nodes must exchange control plane traffic, pod networking data, and health status information freely. Without self-referencing rules, the cluster components cannot communicate, and the cluster will fail to initialize.

### 5.3 Complete Port and Configuration Reference

This comprehensive table documents all network ports, protocols, and their purposes in the Kubernetes cluster.

#### 5.3.1 Control Plane Ports

| Port Range | Protocol | Component               | Direction | Purpose                                           | Security Group Rule |
| ---------- | -------- | ----------------------- | --------- | ------------------------------------------------- | ------------------- |
| 6443       | TCP      | kube-apiserver          | Inbound   | Kubernetes API server (all cluster communication) | Self-referencing    |
| 2379-2380  | TCP      | etcd                    | Inbound   | etcd server client/peer communication             | Self-referencing    |
| 10250      | TCP      | kubelet                 | Inbound   | Kubelet API (metrics, logs, exec)                 | Self-referencing    |
| 10259      | TCP      | kube-scheduler          | Inbound   | Scheduler health checks                           | Self-referencing    |
| 10257      | TCP      | kube-controller-manager | Inbound   | Controller manager health checks                  | Self-referencing    |

#### 5.3.2 Worker Node Ports

| Port Range  | Protocol | Component               | Direction | Purpose                             | Security Group Rule        |
| ----------- | -------- | ----------------------- | --------- | ----------------------------------- | -------------------------- |
| 10250       | TCP      | kubelet                 | Inbound   | Kubelet API (same as control plane) | Self-referencing           |
| 30000-32767 | TCP      | NodePort Services       | Inbound   | External access to services         | 0.0.0.0/0 or specific CIDR |
| 30080       | TCP      | k8s-autoscaling-service | Inbound   | Application HTTP endpoint           | 0.0.0.0/0                  |

#### 5.3.3 CNI (Calico) Ports

| Port Range | Protocol | Component    | Direction     | Purpose                                    | Security Group Rule |
| ---------- | -------- | ------------ | ------------- | ------------------------------------------ | ------------------- |
| 179        | TCP      | Calico BGP   | Bidirectional | BGP routing protocol for pod networking    | Self-referencing    |
| 4789       | UDP      | Calico VXLAN | Bidirectional | VXLAN overlay network (if IPinIP not used) | Self-referencing    |

#### 5.3.4 Administrative Access

| Port Range | Protocol | Component | Direction | Purpose               | Security Group Rule |
| ---------- | -------- | --------- | --------- | --------------------- | ------------------- |
| 22         | TCP      | SSH       | Inbound   | Remote administration | Your IP/32          |

#### 5.3.5 Application-Specific Ports

| Port  | Protocol | Component          | Scope              | Purpose                                          |
| ----- | -------- | ------------------ | ------------------ | ------------------------------------------------ |
| 3000  | TCP      | Node.js App        | Internal (Pod)     | Application HTTP server (not exposed externally) |
| 80    | TCP      | Kubernetes Service | Internal (Cluster) | Service abstraction layer                        |
| 30080 | TCP      | NodePort           | External           | Public access mapped to Service port 80          |

#### 5.3.6 Resource Quotas and Limits

These values are defined in [k8s-app.yaml](k8s-app.yaml) and directly affect HPA calculations.

| Resource Type | Request | Limit | Purpose                                            |
| ------------- | ------- | ----- | -------------------------------------------------- |
| CPU           | 100m    | 500m  | Guarantees 0.1 CPU core, allows burst to 0.5 cores |
| Memory        | 128Mi   | 256Mi | Guarantees 128MB, allows burst to 256MB            |

**HPA Utilization Calculation:**

```
CPU Utilization % = (Actual CPU Usage / CPU Request) * 100
Example: Pod using 75m CPU = (75m / 100m) * 100 = 75% utilization
```

#### 5.3.7 HPA Configuration Parameters

Defined in [k8s-hpa.yaml](k8s-hpa.yaml):

| Parameter                            | Value | Purpose                                                 |
| ------------------------------------ | ----- | ------------------------------------------------------- |
| minReplicas                          | 1     | Minimum pods even at zero load                          |
| maxReplicas                          | 10    | Maximum pods to prevent resource exhaustion             |
| targetAverageUtilization             | 50%   | HPA maintains average CPU at 50% across all pods        |
| scaleUp.stabilizationWindowSeconds   | 0     | Scale up immediately when threshold exceeded            |
| scaleDown.stabilizationWindowSeconds | 60    | Wait 60 seconds before scaling down to prevent flapping |
| scaleUp.policies.Percent.value       | 100   | Double replica count every 15 seconds                   |
| scaleUp.policies.Pods.value          | 2     | OR add 2 pods every 15 seconds (whichever is greater)   |
| scaleDown.policies.Percent.value     | 50    | Reduce by 50% every 15 seconds                          |
| scaleDown.policies.Pods.value        | 1     | OR remove 1 pod every 15 seconds (whichever is smaller) |

---

## 6. Implementation Guide

### 6.1 Phase 1: Local Verification

Before provisioning AWS infrastructure, validate that the application functions correctly in a local environment. This practice prevents costly debugging on cloud resources.

#### Option A: Docker Compose Testing (No Autoscaling)

This method provides rapid validation of the application container without Kubernetes overhead.

```bash
# Clone the repository
git clone https://github.com/Adamo-97/k8s_autoscaling.git
cd k8s_autoscaling

# Start the application using Docker Compose
docker compose up --build -d

# Verify the application is running
curl http://localhost:3000/health

# Expected response:
# {"status":"healthy","pod":"<container-id>","timestamp":"..."}

# Test the CPU load endpoint
curl http://localhost:3000/cpu-load

# Access the dashboard
# Open http://localhost:3000 in a web browser

# Cleanup
docker compose down
```

#### Option B: Minikube Testing (Full Autoscaling)

This method provides a complete HPA demonstration in a local Kubernetes environment.

```bash
# Start Minikube with sufficient resources
minikube start --driver=docker --cpus=2 --memory=4096

# Enable the metrics-server addon
minikube addons enable metrics-server

# Build the application image within Minikube's Docker context
eval $(minikube docker-env)
docker build -t k8s-autoscaling-demo:latest .

# Create a local manifest with the correct image reference
sed 's|YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest|k8s-autoscaling-demo:latest|g' \
    k8s-app.yaml > k8s-app-local.yaml
echo '        imagePullPolicy: Never' >> k8s-app-local.yaml

# Deploy the application
kubectl apply -f k8s-app-local.yaml
kubectl apply -f k8s-hpa.yaml

# Wait for pods to be ready
kubectl wait --for=condition=ready pod -l app=k8s-autoscaling --timeout=120s

# Get the service URL
minikube service k8s-autoscaling-service --url

# Monitor HPA in a separate terminal
watch -n 1 kubectl get hpa,pods

# Generate load to trigger scaling (run in another terminal)
SERVICE_URL=$(minikube service k8s-autoscaling-service --url)
for i in $(seq 1 50); do
    curl -s "${SERVICE_URL}/cpu-load" &
    sleep 0.5
done

# Cleanup
kubectl delete -f k8s-hpa.yaml
kubectl delete -f k8s-app-local.yaml
minikube stop
```

#### Option C: Automated Local Testing with Helper Script

The project includes an automated testing script that handles tool detection and setup.

```bash
# Run Docker Compose test (recommended for quick validation)
bash local-test.sh docker

# Run Minikube test (full HPA validation)
bash local-test.sh minikube
```

**Auto-Setup Feature:** If Docker or Minikube is not installed, the script will detect your Linux distribution and offer to run the appropriate setup script (`local-setup-ubuntu.sh` or `local-setup-fedora.sh`) with your confirmation.

---

### 6.2 Phase 2: AWS Production Deployment with Automated Scripts

This section provides comprehensive instructions for deploying the Kubernetes cluster on AWS EC2 infrastructure using automated deployment scripts.

#### Prerequisites: AWS CLI Setup and Configuration

Before running the deployment scripts, you must have AWS CLI installed and properly configured.

##### Installing AWS CLI

**Check if AWS CLI is already installed:**

```bash
aws --version
```

**Expected output (if installed):**

```
aws-cli/2.x.x Python/3.x.x Linux/x86_64
```

**If not installed, install AWS CLI:**

**Linux (x86_64):**

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

**macOS:**

```bash
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /
```

**Windows:** Download and run the MSI installer from [AWS CLI Install Page](https://aws.amazon.com/cli/).

##### Configuring AWS Credentials

The deployment scripts require valid AWS credentials to create and manage resources.

**Step 1: Obtain AWS Access Keys**

1. Log in to AWS Console
2. Navigate to IAM → Users → Your User → Security Credentials
3. Click "Create access key"
4. Select "Command Line Interface (CLI)"
5. Save the Access Key ID and Secret Access Key

**Step 2: Configure AWS CLI**

```bash
aws configure
```

**You will be prompted for:**

```
AWS Access Key ID [None]: AKIAIOSFODNN7EXAMPLE
AWS Secret Access Key [None]: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
Default region name [None]: us-east-1
Default output format [None]: json
```

**Step 3: Verify Configuration**

```bash
# Test authentication
aws sts get-caller-identity
```

**Expected output:**

```json
{
  "UserId": "AIDAJEXAMPLEID",
  "Account": "123456789012",
  "Arn": "arn:aws:iam::123456789012:user/your-username"
}
```

**Step 4: Test Basic AWS Operations**

```bash
# List available regions
aws ec2 describe-regions --output table

# Check current region
aws configure get region

# List any existing EC2 instances (may be empty)
aws ec2 describe-instances --query 'Reservations[*].Instances[*].{ID:InstanceId,State:State.Name}' --output table
```

##### Running the Prerequisites Check

Before deployment, run the automated prerequisites checker:

```bash
bash aws/check-prerequisites.sh
```

**What this script checks:**

- ✓ AWS CLI installation
- ✓ AWS credentials configuration
- ✓ Required files (setup_aws_node.sh)
- ✓ AWS region configuration
- ✓ Internet connectivity
- ✓ Cost estimation

**Expected output:**

```
===========================================
   AWS Prerequisites Check
===========================================

Checking AWS CLI installation... ✓ aws-cli/2.x.x
Checking AWS credentials... ✓ Account: 123456789012, User: your-user
Checking required files... ✓ All files present
Checking AWS region... ✓ us-east-1
Checking internet connectivity... ✓ Public IP: xxx.xxx.xxx.xxx

===========================================
   Cost Estimation
===========================================
Instance Type: t3.medium (3 instances)
Storage: 20GB gp3 per instance
Estimated Cost: ~$0.15/hour (~$3.60/day)

WARNING: Remember to run teardown_infra.sh when done!

===========================================
✓ All prerequisites met!
===========================================
```

#### Understanding the Deployment Architecture

The deployment process is modularized into separate scripts for maintainability:

**Main Deployment Script:**

- `deploy_infra.sh` - Orchestrates the entire deployment process

**Helper Scripts (in aws/ directory):**

- `check-prerequisites.sh` - Validates AWS CLI and credentials
- `setup-keypair.sh` - Creates SSH key pair (idempotent)
- `setup-security-group.sh` - Configures security group with all required rules (idempotent)
- `launch-instances.sh` - Launches EC2 instances and waits for readiness

**AWS Resources Created:**

1. **SSH Key Pair** (`k8s-autoscaling-demo-key`)
   - Used to SSH into EC2 instances
   - Private key saved locally as `k8s-autoscaling-demo-key.pem`
2. **Security Group** (`k8s-autoscaling-demo-sg`)
   - SSH access from your IP
   - NodePort 30080 access from anywhere
   - Internal cluster communication (self-referencing rule)
3. **EC2 Instances** (3x t3.medium)
   - Ubuntu 22.04 LTS
   - 20GB gp3 storage each
   - User data script auto-installs Kubernetes components

#### Step 1: Prepare the Docker Image

Before deploying to AWS, the container image must be available in a public registry.

```bash
# Build the production image
docker build -t YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest .

# Authenticate with Docker Hub
docker login

# Push the image to Docker Hub
docker push YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest

# Update k8s-app.yaml with your Docker Hub username
sed -i 's|adamabd97/k8s-autoscaling-demo|YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo|g' k8s-app.yaml
```

**Technical Rationale:** Kubernetes worker nodes pull container images from registries. By pushing to Docker Hub (or another accessible registry), we ensure that all nodes can retrieve the application image during deployment.

#### Step 2: Run the Automated Deployment Script

The deployment script handles all AWS resource creation automatically:

```bash
# Basic deployment (uses defaults: us-east-1, t3.medium, 3 instances)
bash deploy_infra.sh

# Custom deployment with options
bash deploy_infra.sh \
  --region us-west-2 \
  --instance-type t3.large \
  --count 3 \
  --cluster-name my-k8s-cluster

# Skip prerequisite checks (not recommended)
bash deploy_infra.sh --skip-checks

# View all available options
bash deploy_infra.sh --help
```

**What the deployment script does:**

1. **[STEP 0]** Runs prerequisite checks (validates AWS CLI, credentials, files)
2. **[STEP 1]** Fetches latest Ubuntu 22.04 AMI ID for the specified region
3. **[STEP 2]** Creates SSH key pair (saves `k8s-autoscaling-demo-key.pem` locally)
4. **[STEP 3]** Creates and configures security group with required rules
5. **[STEP 4]** Launches 3 EC2 instances with user data script
6. Waits for instances to reach "running" state
7. Waits for system status checks to pass
8. Waits for user data script to complete (installs containerd, kubeadm, kubelet)

**Expected output:**

```
===========================================
   AWS Infrastructure Deployment
===========================================
Cluster Name:    k8s-autoscaling-demo
Region:          us-east-1
Instance Type:   t3.medium
Instance Count:  3
===========================================

[STEP 0] Running prerequisite checks...
✓ All prerequisites met!

[STEP 1] Fetching latest Ubuntu 22.04 AMI...
[OK] AMI Selected: ami-0c7217cdde317cfec

[STEP 2] Setting up SSH key pair...
[OK] Key saved to: k8s-autoscaling-demo-key.pem

[STEP 3] Setting up security group...
[OK] Security Group: sg-0123456789abcdef0

[STEP 4] Launching EC2 instances...
[OK] Launched instances: i-001 i-002 i-003
[OK] All instances are running
[OK] All system status checks passed
[OK] Background setup should be complete

===========================================
   DEPLOYMENT COMPLETE
===========================================

--------------------------------------------------------------
|              DescribeInstances                             |
+---------------+-----------------+--------------+----------+
|       ID      |    PublicIP     |  PrivateIP   |  State   |
+---------------+-----------------+--------------+----------+
|  i-001        |  54.x.x.1       |  172.31.x.1  |  running |
|  i-002        |  54.x.x.2       |  172.31.x.2  |  running |
|  i-003        |  54.x.x.3       |  172.31.x.3  |  running |
+---------------+-----------------+--------------+----------+

===========================================
   NEXT STEPS
===========================================

1. WAIT: User data script is running in background (3-5 minutes)
   Installing: containerd, kubeadm, kubelet, kubectl

2. VERIFY: SSH into first node to check installation status:
   ssh -i k8s-autoscaling-demo-key.pem ubuntu@54.x.x.1
   sudo systemctl status kubelet  # Should be active

3. INITIALIZE: On the first node (control plane):
   sudo kubeadm init --pod-network-cidr=192.168.0.0/16

4. CONFIGURE: After kubeadm init completes:
   mkdir -p $HOME/.kube
   sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
   sudo chown $(id -u):$(id -g) $HOME/.kube/config

5. INSTALL CNI: Install Calico network plugin:
   kubectl apply -f https://docs.projectcalico.org/manifests/calico.yaml

6. JOIN WORKERS: SSH into remaining nodes and run the 'kubeadm join' command
   from the init output

===========================================

Cluster Name: k8s-autoscaling-demo
Key File:     k8s-autoscaling-demo-key.pem
Region:       us-east-1

To destroy infrastructure: bash teardown_infra.sh
===========================================
```

**Deployment time:** Approximately 5-7 minutes total:

- 1-2 minutes: Instance launch and initialization
- 3-5 minutes: User data script execution (background)

#### Understanding AWS CLI Commands Used

The deployment scripts use several AWS CLI commands. Here's what each does:

**1. Describe Images (Find Ubuntu AMI):**

```bash
aws ec2 describe-images \
    --region us-east-1 \
    --owners 099720109477 \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
    --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
    --output text
```

- **Purpose:** Finds the latest Ubuntu 22.04 AMI ID
- **Owner ID 099720109477:** Canonical's official AWS account
- **Query:** Sorts by creation date, returns newest AMI ID

**2. Create Key Pair:**

```bash
aws ec2 create-key-pair \
    --region us-east-1 \
    --key-name k8s-autoscaling-demo-key \
    --query 'KeyMaterial' \
    --output text > k8s-autoscaling-demo-key.pem
```

- **Purpose:** Creates SSH key pair in AWS
- **Output:** Private key material saved to .pem file
- **Security:** Automatically set to 400 permissions

**3. Create Security Group:**

```bash
aws ec2 create-security-group \
    --region us-east-1 \
    --group-name k8s-autoscaling-demo-sg \
    --description "Kubernetes Autoscaling Demo" \
    --query 'GroupId'
```

- **Purpose:** Creates firewall rules container
- **Returns:** Security group ID (sg-xxxx)

**4. Authorize Security Group Ingress:**

```bash
# SSH access
aws ec2 authorize-security-group-ingress \
    --region us-east-1 \
    --group-id sg-xxxx \
    --protocol tcp \
    --port 22 \
    --cidr YOUR_IP/32

# NodePort access
aws ec2 authorize-security-group-ingress \
    --region us-east-1 \
    --group-id sg-xxxx \
    --protocol tcp \
    --port 30080 \
    --cidr 0.0.0.0/0

# Internal cluster communication
aws ec2 authorize-security-group-ingress \
    --region us-east-1 \
    --group-id sg-xxxx \
    --protocol all \
    --source-group sg-xxxx
```

- **Purpose:** Adds firewall rules to security group
- **SSH Rule:** Restricts to your public IP only
- **NodePort Rule:** Allows public dashboard access
- **Self-Reference Rule:** Allows inter-node communication

**5. Run Instances:**

```bash
aws ec2 run-instances \
    --region us-east-1 \
    --image-id ami-xxxx \
    --count 3 \
    --instance-type t3.medium \
    --key-name k8s-autoscaling-demo-key \
    --security-group-ids sg-xxxx \
    --user-data file://setup_aws_node.sh \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=k8s-autoscaling-demo-node}]' \
    --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]'
```

- **Purpose:** Launches EC2 instances
- **User Data:** Automatically runs setup_aws_node.sh on first boot
- **Tags:** Allows easy identification and filtering
- **Storage:** 20GB gp3 SSD (faster than gp2)

**6. Wait for Instances:**

```bash
# Wait for running state
aws ec2 wait instance-running \
    --region us-east-1 \
    --instance-ids i-001 i-002 i-003

# Wait for status checks
aws ec2 wait instance-status-ok \
    --region us-east-1 \
    --instance-ids i-001 i-002 i-003
```

- **Purpose:** Blocks until instances are fully ready
- **Timeout:** Default 40 attempts × 15 seconds = 10 minutes

**7. Describe Instances:**

```bash
aws ec2 describe-instances \
    --region us-east-1 \
    --instance-ids i-001 i-002 i-003 \
    --query 'Reservations[*].Instances[*].{ID:InstanceId,IP:PublicIpAddress}' \
    --output table
```

- **Purpose:** Retrieves instance details (IPs, state, etc.)
- **Query:** Filters to show only relevant fields
- **Output:** Formatted as table for readability

#### Step 2 (Manual Alternative): Launch EC2 Instances via AWS Console

If you prefer using the AWS Console instead of the automated script:

This section provides detailed instructions for deploying the Kubernetes cluster on AWS EC2 infrastructure using the automated setup scripts.

#### Step 1: Prepare the Docker Image

Before deploying to AWS, the container image must be available in a public registry.

```bash
# Build the production image
docker build -t YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest .

# Authenticate with Docker Hub
docker login

# Push the image to Docker Hub
docker push YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest
```

**Technical Rationale:** Kubernetes worker nodes pull container images from registries. By pushing to Docker Hub (or another accessible registry), we ensure that all nodes can retrieve the application image during deployment.

#### Step 2: Launch EC2 Instances

Using the AWS Console or CLI, launch three EC2 instances with the specifications defined in Section 5.2.

**AWS Console Method:**

1. Navigate to EC2 Dashboard
2. Select "Launch Instance"
3. Choose Ubuntu Server 22.04 LTS AMI
4. Select t3.medium instance type
5. Configure storage: 20 GB gp3
6. Select or create the security group defined in Section 5.2
7. Launch three instances with descriptive names:
   - `k8s-control-plane`
   - `k8s-worker-1`
   - `k8s-worker-2`

**AWS CLI Method:**

```bash
# Create security group
aws ec2 create-security-group \
    --group-name k8s-cluster-sg \
    --description "Security group for Kubernetes cluster"

# Add security group rules (repeat for each rule in Section 4.2)
aws ec2 authorize-security-group-ingress \
    --group-name k8s-cluster-sg \
    --protocol tcp \
    --port 22 \
    --cidr YOUR_IP/32

# Launch instances
aws ec2 run-instances \
    --image-id ami-0c7217cdde317cfec \
    --instance-type t3.medium \
    --count 3 \
    --key-name your-key-pair \
    --security-groups k8s-cluster-sg \
    --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]'
```

#### Step 3: Copy Setup Script to AWS Nodes

Transfer the automation script to all EC2 instances to simplify configuration.

**Method 1: Using SCP (Secure Copy)**

```bash
# Copy the script to each node
scp -i your-key.pem setup_aws_node.sh ubuntu@<CONTROL_PLANE_IP>:~
scp -i your-key.pem setup_aws_node.sh ubuntu@<WORKER1_IP>:~
scp -i your-key.pem setup_aws_node.sh ubuntu@<WORKER2_IP>:~
```

**Method 2: Using Git Clone (if repository is public)**

```bash
# On each node
ssh -i your-key.pem ubuntu@<NODE_IP>
git clone https://github.com/Adamo-97/k8s_autoscaling.git
cd k8s_autoscaling
```

**Method 3: Direct Download (using curl/wget)**

```bash
# On each node
ssh -i your-key.pem ubuntu@<NODE_IP>
curl -O https://raw.githubusercontent.com/Adamo-97/k8s_autoscaling/main/setup_aws_node.sh
chmod +x setup_aws_node.sh
```

#### Step 4: Run Automated Setup on All Nodes

Execute the setup script on each node (control plane and both workers). This script automates all manual configuration steps.

**Script Execution Order:**

1. **Control Plane Node** - Run setup script FIRST
2. **Worker Node 1** - Run setup script SECOND
3. **Worker Node 2** - Run setup script THIRD

**On Each Node (Control Plane and Workers):**

```bash
# Connect to the node
ssh -i your-key.pem ubuntu@<NODE_IP>

# Run the setup script with sudo
sudo bash setup_aws_node.sh
```

**What the Script Does:**

The `setup_aws_node.sh` script automates the following steps:

1. Disables swap memory
2. Loads kernel modules (overlay, br_netfilter)
3. Configures sysctl networking parameters
4. Installs and configures containerd runtime with SystemdCgroup
5. Installs kubeadm, kubelet, and kubectl (version 1.28)
6. Enables kubelet service
7. Holds package versions to prevent automatic upgrades

**Expected Output:**

```
===========================================
   Kubernetes Node Setup - Ubuntu 22.04
===========================================

[STEP 1] Disabling swap...
[OK] Swap disabled

[STEP 2] Loading kernel modules...
[OK] Kernel modules loaded

[STEP 3] Configuring sysctl parameters...
[OK] Sysctl parameters configured

[STEP 4] Installing containerd...
[OK] containerd installed

[STEP 5] Configuring containerd with SystemdCgroup...
[OK] containerd configured and started

[STEP 6] Installing kubeadm, kubelet, kubectl...
[OK] Kubernetes components installed and held

[STEP 7] Enabling kubelet service...
[OK] kubelet enabled

===========================================
[SUCCESS] Setup Complete!
===========================================
```

**Execution Time:** Approximately 2-3 minutes per node

**Technical Rationale:** Using the automated script ensures consistency across all nodes, reduces human error, and documents the exact configuration steps in version-controlled code.

#### Step 4 (Deprecated - Manual Configuration)

The following manual steps are documented for reference but are NOT REQUIRED if using `setup_aws_node.sh`.

<details>
<summary>Click to expand manual configuration steps (not recommended)</summary>

**3.2: Disable Swap Memory**

```bash
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab
```

**Technical Rationale:** Kubernetes requires swap to be disabled because the scheduler makes memory allocation decisions based on available RAM. When swap is enabled, memory availability becomes unpredictable, which violates the assumptions of the Quality of Service (QoS) model. The kubelet will refuse to start if swap is detected.

**3.3: Load Required Kernel Modules**

```bash
cat <<EOF | sudo tee /etc/modules-load.d/containerd.conf
overlay
br_netfilter
EOF

sudo modprobe overlay
sudo modprobe br_netfilter
```

**Technical Rationale:**

- `overlay`: Required by containerd for layered filesystem support in containers
- `br_netfilter`: Enables iptables to see bridged traffic, which is necessary for Kubernetes networking rules to function correctly

**3.4: Configure Kernel Parameters**

```bash
cat <<EOF | sudo tee /etc/sysctl.d/99-kubernetes-cri.conf
net.bridge.bridge-nf-call-iptables  = 1
net.ipv4.ip_forward                 = 1
net.bridge.bridge-nf-call-ip6tables = 1
EOF

sudo sysctl --system
```

**Technical Rationale:** These parameters enable:

- IP forwarding between network interfaces (required for pod-to-pod communication across nodes)
- Bridge traffic to be processed by iptables (required for Service load balancing and Network Policies)

**3.5: Install containerd**

```bash
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl software-properties-common

curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y containerd.io
```

**3.6: Configure containerd with SystemdCgroup**

```bash
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml > /dev/null
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
sudo systemctl restart containerd
sudo systemctl enable containerd
```

**Technical Rationale:** Ubuntu 22.04 uses systemd as its init system. The kubelet also uses systemd to manage cgroups. If containerd uses a different cgroup driver (cgroupfs), there will be two cgroup managers competing for resources, causing instability. Setting `SystemdCgroup = true` ensures containerd delegates cgroup management to systemd, maintaining consistency.

**3.7: Install Kubernetes Components**

```bash
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.28/deb/Release.key | sudo gpg --dearmor -o /usr/share/keyrings/kubernetes-apt-keyring.gpg

echo 'deb [signed-by=/usr/share/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.28/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list

sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl
```

**Technical Rationale:** The `apt-mark hold` command prevents automatic upgrades of Kubernetes components. Version mismatches between nodes can cause cluster instability; all nodes should run identical versions.

</details>

#### Step 5: Initialize the Control Plane

Execute the following commands ONLY on the control plane node.

```bash
# Initialize the Kubernetes control plane
sudo kubeadm init --pod-network-cidr=192.168.0.0/16
```

**IMPORTANT:** Save the `kubeadm join` command from the output. It will look like this:

```
kubeadm join <CONTROL_PLANE_IP>:6443 --token <TOKEN> \
    --discovery-token-ca-cert-hash sha256:<HASH>
```

**Configure kubectl Access:**

```bash
# Configure kubectl for the ubuntu user
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# Verify the control plane is running
kubectl get nodes

# Expected output:
# NAME              STATUS     ROLES           AGE   VERSION
# k8s-control-plane NotReady   control-plane   30s   v1.28.x
```

**Note:** The node shows `NotReady` until the CNI plugin is installed in the next step.

**Technical Rationale for Pod Network CIDR:** The `--pod-network-cidr=192.168.0.0/16` parameter specifies the IP address range for pod networking. This value is required by Calico CNI; using a different CIDR requires corresponding changes to the Calico manifest.

#### Step 6: Install Calico CNI

Execute on the control plane node:

```bash
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.26.1/manifests/calico.yaml

# Wait for Calico pods to be ready (press Ctrl+C when all pods are Running)
kubectl get pods -n kube-system -w

# Verify node is now Ready
kubectl get nodes
```

**Expected Output:**

```
NAME              STATUS   ROLES           AGE   VERSION
k8s-control-plane Ready    control-plane   2m    v1.28.x
```

**Technical Rationale:** Without a CNI plugin, pods cannot communicate across nodes. Calico provides layer 3 networking using BGP, offering high performance without encapsulation overhead. It also provides Network Policy enforcement for pod-level firewall rules.

#### Step 7: Join Worker Nodes

Execute the saved `kubeadm join` command on EACH worker node:

```bash
# On Worker Node 1
ssh -i your-key.pem ubuntu@<WORKER1_IP>
sudo kubeadm join <CONTROL_PLANE_IP>:6443 --token <TOKEN> \
    --discovery-token-ca-cert-hash sha256:<HASH>

# On Worker Node 2
ssh -i your-key.pem ubuntu@<WORKER2_IP>
sudo kubeadm join <CONTROL_PLANE_IP>:6443 --token <TOKEN> \
    --discovery-token-ca-cert-hash sha256:<HASH>
```

Verify on the control plane:

```bash
kubectl get nodes

# Expected output:
# NAME              STATUS   ROLES           AGE   VERSION
# k8s-control-plane Ready    control-plane   5m    v1.28.x
# k8s-worker-1      Ready    <none>          2m    v1.28.x
# k8s-worker-2      Ready    <none>          2m    v1.28.x
```

#### Step 7: Install Metrics Server

The Metrics Server is required for HPA functionality.

```bash
# Download the manifest
wget https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Add the --kubelet-insecure-tls flag (required for self-signed certificates)
sed -i '/- args:/a\        - --kubelet-insecure-tls' components.yaml

# Apply the manifest
kubectl apply -f components.yaml

# Verify installation (may take 1-2 minutes)
kubectl get deployment metrics-server -n kube-system
kubectl top nodes
```

**Technical Rationale:** In self-managed clusters, kubelets use self-signed certificates. The Metrics Server, by default, requires valid TLS certificates. The `--kubelet-insecure-tls` flag bypasses this verification. In production environments, proper certificate management should be implemented instead.

#### Step 9: Deploy RBAC, Application, and HPA

```bash
# Update k8s-app.yaml with your Docker Hub username
sed -i 's|adamabd97/k8s-autoscaling-demo:latest|YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest|g' k8s-app.yaml

# Apply RBAC permissions
kubectl apply -f k8s-rbac.yaml

# Apply application and HPA
kubectl apply -f k8s-app.yaml
kubectl apply -f k8s-hpa.yaml

# Verify deployment
kubectl get hpa
```

#### Step 10: Access and Test

```bash
# Get node IP
kubectl get nodes -o wide

# Test: http://<NODE_IP>:30080
curl http://<NODE_IP>:30080/health

# Copy load generator (optional)
scp -i your-key.pem load-generator.sh ubuntu@<CONTROL_PLANE_IP>:~
```

---

## 7. Verification and Monitoring

### 7.1 Presentation Dashboard Split-Screen Method

For demonstration and grading purposes, the following "Split-Screen Method" provides clear visual evidence of autoscaling behavior.

#### Screen 1: Infrastructure Level (AWS Console)

This view demonstrates that EC2 instance CPU utilization increases during load testing.

**Steps:**

1. Log in to the AWS Console
2. Navigate to EC2 > Instances
3. Select one of the worker nodes
4. Click the "Monitoring" tab
5. Locate the "CPU Utilization" graph
6. Set the time range to "1 hour" with "1 minute" granularity

**What to Observe:** During load testing, CPU utilization should rise from baseline (typically 1-5%) to elevated levels (20-50% or higher depending on load intensity).

#### Screen 2: Application Level (Terminal)

This view demonstrates that the HPA responds to increased CPU utilization by creating additional pod replicas.

**Command:**

```bash
watch -n 1 'kubectl get hpa,pods -o wide'
```

**What to Observe:**

- The HPA `TARGETS` column shows current CPU usage versus the target (e.g., `75%/50%`)
- The `REPLICAS` column increases from 1 to 2, 3, or more
- New pods appear in the pod list with `Running` status

### 7.2 Critical Metrics for Autoscaling Validation on AWS

The following metrics must be monitored to demonstrate successful HPA implementation.

#### 7.2.1 Pod-Level Metrics

**Command:**

```bash
kubectl top pods
```

**Expected Values:**

| State      | CPU Usage      | Memory Usage    | Replica Count      |
| ---------- | -------------- | --------------- | ------------------ |
| Idle       | 1-5m           | 30-50Mi         | 1                  |
| Under Load | 50-100m+       | 50-80Mi         | 1 (before scaling) |
| Scaled Up  | 30-60m per pod | 45-65Mi per pod | 2-10 (distributed) |

#### 7.2.2 HPA Metrics

**Command:**

```bash
kubectl get hpa
kubectl describe hpa k8s-autoscaling-hpa
```

**Key Fields:**

| Field    | Idle   | Under Load | Scaling | Post-Scale |
| -------- | ------ | ---------- | ------- | ---------- |
| TARGETS  | 0%/50% | 75%/50%    | 65%/50% | 45%/50%    |
| REPLICAS | 1      | 1->2->3    | 3       | 3 (stable) |

**Critical Events:**

```yaml
Events:
  Normal  SuccessfulRescale  30s  horizontal-pod-autoscaler  New size: 2; reason: cpu resource utilization above target
  Normal  SuccessfulRescale  15s  horizontal-pod-autoscaler  New size: 3; reason: cpu resource utilization above target
```

#### 7.2.3 Node-Level Metrics

**Command:**

```bash
kubectl top nodes
```

**Expected Values:**

| Node Type     | CPU (Idle) | CPU (Load) | Memory Usage |
| ------------- | ---------- | ---------- | ------------ |
| Control Plane | 5-10%      | 10-15%     | 800Mi-1.2Gi  |
| Worker 1      | 2-5%       | 15-40%     | 600Mi-1Gi    |
| Worker 2      | 2-5%       | 15-40%     | 600Mi-1Gi    |

#### 7.2.4 AWS CloudWatch Metrics

Monitor in AWS Console:

| Metric          | Idle      | Under Load  | Alert At       |
| --------------- | --------- | ----------- | -------------- |
| CPU Utilization | 1-5%      | 20-60%      | >80% sustained |
| Network In      | <100 KB/s | 500KB-5MB/s | Monitor trends |
| Network Out     | <100 KB/s | 500KB-5MB/s | Monitor trends |

#### 7.2.5 Scaling Timeline

| Time   | Event              | HPA Status   | Pod Count |
| ------ | ------------------ | ------------ | --------- |
| T+0s   | Load starts        | CPU: 0%/50%  | 1         |
| T+15s  | Threshold exceeded | CPU: 75%/50% | 1         |
| T+30s  | First scale-up     | CPU: 60%/50% | 2         |
| T+45s  | Second scale-up    | CPU: 55%/50% | 3         |
| T+60s  | Stabilized         | CPU: 48%/50% | 3         |
| T+120s | Load stops         | CPU: 10%/50% | 3         |
| T+180s | Scale-down begins  | CPU: 15%/50% | 2         |
| T+240s | Return to baseline | CPU: 0%/50%  | 1         |

### 7.3 Generating Load for Demonstration

Use the provided load generator script or manual commands.

**Option 1: Using load-generator.sh (Recommended)**

```bash
# On the control plane
ssh -i your-key.pem ubuntu@<CONTROL_PLANE_IP>

# Moderate load
bash load-generator.sh http://<NODE_IP>:30080 100 10

# Heavy load
bash load-generator.sh http://<NODE_IP>:30080 200 20
```

**Option 2: Manual curl Loop**

```bash
for i in $(seq 1 100); do
    curl -s "http://<NODE_IP>:30080/cpu-load" &
    sleep 0.2
done
```

### 7.4 Verification Checklist

- [ ] Metrics Server reporting (`kubectl top nodes` works)
- [ ] HPA created (`kubectl get hpa` shows resource)
- [ ] Initial state: 1 pod, 0%/50% target
- [ ] Load generation initiated
- [ ] Pod CPU exceeds 50% (`kubectl top pods`)
- [ ] HPA events show `SuccessfulRescale`
- [ ] Replica count increases (2, 3, etc.)
- [ ] AWS Console shows EC2 CPU spike
- [ ] Scale-down occurs after load stops (60s delay)
- [ ] System returns to 1 replica

### Combined Evidence Statement

The combination of these two views provides comprehensive evidence of autoscaling:

1. **AWS Console (Screen 1):** Proves that the underlying infrastructure is experiencing increased CPU demand
2. **Terminal (Screen 2):** Proves that the Kubernetes HPA controller detects this demand and responds by scaling the application

Together, these views demonstrate the complete feedback loop: User Load -> Pod CPU Increase -> Metrics Server Detection -> HPA Scaling Decision -> New Pod Creation -> Load Distribution.

---

## 8. Cost Management and Cleanup

AWS resources incur charges as long as they exist. This project includes automated scripts to safely destroy all AWS resources created during deployment.

### Using the Automated Teardown Script

The recommended method for cleanup is to use the automated teardown script, which safely removes all resources in the correct order:

```bash
# Basic teardown (prompts for confirmation)
bash teardown_infra.sh

# Skip confirmation prompt (use with caution)
bash teardown_infra.sh --force

# Teardown specific cluster or region
bash teardown_infra.sh --cluster-name my-cluster --region us-west-2

# View all options
bash teardown_infra.sh --help
```

**What the teardown script does:**

1. **Finds all instances** tagged with the cluster name
2. **Displays instance details** before termination (for confirmation)
3. **Terminates EC2 instances** and waits for complete termination
4. **Deletes security group** (waits for network interfaces to be released)
5. **Deletes SSH key pair** from AWS and removes local .pem file
6. **Verifies cleanup** and provides summary

**Expected output:**

```
===========================================
   AWS Infrastructure Teardown
===========================================
Cluster Name: k8s-autoscaling-demo
Region:       us-east-1
===========================================

WARNING: This will PERMANENTLY DELETE:
  - All EC2 instances tagged with: k8s-autoscaling-demo-node
  - Security group: k8s-autoscaling-demo-sg
  - SSH key pair: k8s-autoscaling-demo-key
  - Local key file: k8s-autoscaling-demo-key.pem

Are you sure you want to continue? (yes/no): yes

[CHECK] Verifying AWS CLI is available...
[OK] AWS CLI found

[STEP 1] Finding instances...
[FOUND] 3 instance(s): i-001 i-002 i-003

--------------------------------------------------------------
|              DescribeInstances                             |
+---------------+-----------------+--------------+
|       ID      |       IP        |    State     |
+---------------+-----------------+--------------+
|  i-001        |  54.x.x.1       |  running     |
|  i-002        |  54.x.x.2       |  running     |
|  i-003        |  54.x.x.3       |  running     |
+---------------+-----------------+--------------+

[INFO] Terminating instances...
[OK] Termination initiated
[INFO] Waiting for instances to terminate (this may take 1-2 minutes)...
[WAIT] Terminated: 1/3 (10s elapsed)
[WAIT] Terminated: 2/3 (20s elapsed)
[WAIT] Terminated: 3/3 (30s elapsed)
[OK] All instances terminated

[STEP 2] Deleting security group...
[INFO] Waiting 30 seconds for network interfaces to be released...
[OK] Security group deleted: k8s-autoscaling-demo-sg

[STEP 3] Deleting SSH key pair...
[OK] AWS key pair deleted: k8s-autoscaling-demo-key
[OK] Local key file deleted: k8s-autoscaling-demo-key.pem

===========================================
   TEARDOWN COMPLETE
===========================================

Resources cleaned up:
  ✓ EC2 Instances terminated
  ✓ Security Group removed
  ✓ SSH Key Pair deleted

Your AWS account should no longer be charged
for these resources.
===========================================
```

**Teardown time:** Approximately 2-3 minutes

### Manual Cleanup (Alternative Method)

If the automated script fails or you prefer manual cleanup:

#### Using AWS CLI:

```bash
# Step 1: Find all instances
INSTANCE_IDS=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=k8s-autoscaling-demo-node" \
              "Name=instance-state-name,Values=running,pending,stopped" \
    --region us-east-1 \
    --query "Reservations[*].Instances[*].InstanceId" \
    --output text)

echo "Found instances: $INSTANCE_IDS"

# Step 2: Terminate instances
aws ec2 terminate-instances \
    --instance-ids $INSTANCE_IDS \
    --region us-east-1

# Step 3: Wait for termination (optional but recommended)
aws ec2 wait instance-terminated \
    --instance-ids $INSTANCE_IDS \
    --region us-east-1

# Step 4: Delete security group
aws ec2 delete-security-group \
    --group-name k8s-autoscaling-demo-sg \
    --region us-east-1

# Step 5: Delete key pair
aws ec2 delete-key-pair \
    --key-name k8s-autoscaling-demo-key \
    --region us-east-1

# Step 6: Remove local key file
rm -f k8s-autoscaling-demo-key.pem
```

#### Using AWS Console:

1. **EC2 Dashboard → Instances**
   - Filter by tag: `k8s-autoscaling-demo-node`
   - Select all instances
   - Actions → Instance State → Terminate
   - Wait 1-2 minutes for termination to complete
2. **EC2 Dashboard → Security Groups**
   - Find: `k8s-autoscaling-demo-sg`
   - Actions → Delete security group
   - If error "has dependent objects": Wait a few more minutes for network interfaces to detach
3. **EC2 Dashboard → Key Pairs**
   - Find: `k8s-autoscaling-demo-key`
   - Actions → Delete
4. **Local Machine**
   - Delete: `k8s-autoscaling-demo-key.pem`

### Verification Checklist

After cleanup, verify no resources remain:

```bash
# Check for running instances
aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=k8s-autoscaling-demo-node" \
    --region us-east-1 \
    --query 'Reservations[*].Instances[*].{ID:InstanceId,State:State.Name}' \
    --output table

# Expected: Empty table or only "terminated" state

# Check for security groups
aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=k8s-autoscaling-demo-sg" \
    --region us-east-1 \
    --output table

# Expected: Empty result or "does not exist" error

# Check for key pairs
aws ec2 describe-key-pairs \
    --filters "Name=key-name,Values=k8s-autoscaling-demo-key" \
    --region us-east-1 \
    --output table

# Expected: Empty result

# Verify no orphaned volumes
aws ec2 describe-volumes \
    --filters "Name=status,Values=available" \
    --region us-east-1 \
    --query 'Volumes[*].{ID:VolumeId,Size:Size,State:State}' \
    --output table

# Expected: Empty or unrelated volumes only
```

### Manual Cleanup Checklist (Alternative to Automated Script)

For users who prefer a step-by-step manual approach, follow this comprehensive checklist to ensure all AWS resources are properly cleaned up:

| Step | Action                        | Verification                                                           |
| ---- | ----------------------------- | ---------------------------------------------------------------------- |
| 1    | Delete Kubernetes resources   | `kubectl delete -f k8s-hpa.yaml && kubectl delete -f k8s-app.yaml`     |
| 2    | Reset Kubernetes on all nodes | `sudo kubeadm reset -f`                                                |
| 3    | Terminate EC2 instances       | AWS Console > EC2 > Instances > Select all > Terminate                 |
| 4    | Verify EBS volumes deleted    | AWS Console > EC2 > Volumes > Delete any orphaned volumes              |
| 5    | Release Elastic IPs (if any)  | AWS Console > EC2 > Elastic IPs > Release any allocated IPs            |
| 6    | Delete Security Groups        | AWS Console > EC2 > Security Groups > Delete `k8s-autoscaling-demo-sg` |
| 7    | Verify no running resources   | AWS Console > Billing > Cost Explorer > Verify no ongoing charges      |

**Important Notes:**

- Perform steps in order to avoid dependency errors
- Step 1-2 are optional but recommended for clean shutdown
- Steps 3-6 can be automated with `teardown_infra.sh` (see above)
- Step 7 should be checked 24 hours after cleanup to confirm zero charges

### Manual Cleanup Checklist (Alternative to Automated Script)

For users who prefer a step-by-step manual approach, follow this comprehensive checklist to ensure all AWS resources are properly cleaned up:

| Step | Action                        | Verification                                                           |
| ---- | ----------------------------- | ---------------------------------------------------------------------- |
| 1    | Delete Kubernetes resources   | `kubectl delete -f k8s-hpa.yaml && kubectl delete -f k8s-app.yaml`     |
| 2    | Reset Kubernetes on all nodes | `sudo kubeadm reset -f`                                                |
| 3    | Terminate EC2 instances       | AWS Console > EC2 > Instances > Select all > Terminate                 |
| 4    | Verify EBS volumes deleted    | AWS Console > EC2 > Volumes > Delete any orphaned volumes              |
| 5    | Release Elastic IPs (if any)  | AWS Console > EC2 > Elastic IPs > Release any allocated IPs            |
| 6    | Delete Security Groups        | AWS Console > EC2 > Security Groups > Delete `k8s-autoscaling-demo-sg` |
| 7    | Verify no running resources   | AWS Console > Billing > Cost Explorer > Verify no ongoing charges      |

**Important Notes:**

- Perform steps in order to avoid dependency errors
- Step 1-2 are optional but recommended for clean shutdown
- Steps 3-6 can be automated with `teardown_infra.sh` (see above)
- Step 7 should be checked 24 hours after cleanup to confirm zero charges

### Kubernetes Resource Cleanup (Before Terminating Instances)

If you want to clean up Kubernetes resources before destroying infrastructure:

```bash
# On the control plane node
kubectl delete -f k8s-hpa.yaml
kubectl delete -f k8s-rbac.yaml
kubectl delete -f k8s-app.yaml

# Wait for pods to terminate
kubectl get pods --watch

# Optional: Reset kubeadm on all nodes (run on each node)
sudo kubeadm reset -f
sudo rm -rf /etc/cni /etc/kubernetes /var/lib/kubelet /var/lib/etcd ~/.kube
sudo iptables -F && sudo iptables -t nat -F && sudo iptables -t mangle -F && sudo iptables -X
```

### Cost Estimation Reference

Understanding the costs helps you make informed decisions about resource usage:

| Resource            | Hourly Cost (us-east-1) | Daily Cost (24h) | Monthly Cost (730h) |
| ------------------- | ----------------------- | ---------------- | ------------------- |
| t3.medium (x3)      | $0.0416 x 3 = $0.1248   | $2.99            | $91.10              |
| EBS gp3 20GB (x3)   | $0.08/GB-month ÷ 730    | ~$0.16           | $4.80               |
| Data Transfer (OUT) | $0.09/GB (first 10TB)   | Variable         | Variable            |
| **Total Estimated** | ~$0.15/hour             | ~$3.60/day       | ~$96/month          |

**Cost-Saving Recommendations:**

1. **Immediate Termination:** Run `teardown_infra.sh` immediately after demo/testing
2. **Regional Pricing:** us-east-1 is typically cheapest; verify at https://aws.amazon.com/ec2/pricing/
3. **Instance Types:** Don't use t3.large unless necessary (2x the cost)
4. **Forgotten Resources:** Set up AWS billing alerts for unexpected charges
5. **Auto-Shutdown:** Consider using AWS Lambda + EventBridge to auto-shutdown instances after hours

### Common Teardown Issues and Solutions

| Issue                                   | Cause                                    | Solution                                                              |
| --------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| Security group deletion fails           | Network interfaces still attached        | Wait 2-3 minutes; instances may still be terminating                  |
| Cannot find instances                   | Wrong region or cluster name             | Verify region with `aws configure get region`                         |
| Permission denied errors                | Insufficient IAM permissions             | Ensure your IAM user has EC2 full access or admin rights              |
| Local .pem file not found               | File already deleted or moved            | Safe to ignore; no action needed                                      |
| "DependencyViolation" on SG delete      | Security group referenced by other rules | Check for self-referencing rules; wait for all instances to terminate |
| Instances show "terminated" but persist | AWS console lag                          | Refresh after 5 minutes; "terminated" instances don't incur charges   |
| Volumes remain after instance deletion  | "Delete on Termination" not set          | Manually delete orphaned volumes: `aws ec2 delete-volume --volume-id` |

**Important:** "Terminated" instances remain visible in AWS Console for up to 1 hour but do **not** incur charges. They will automatically disappear after the retention period.

---

## 9. Troubleshooting Reference

### Common Issues and Resolutions

| Symptom                             | Probable Cause                              | Resolution                                                                |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| `kubeadm init` fails with CPU error | Instance has fewer than 2 vCPUs             | Use t3.medium or larger                                                   |
| Nodes show `NotReady` status        | CNI not installed or misconfigured          | Verify Calico pods are running: `kubectl get pods -n kube-system`         |
| HPA shows `<unknown>` for metrics   | Metrics Server not running                  | Verify deployment: `kubectl get deployment metrics-server -n kube-system` |
| Pods stuck in `Pending`             | Insufficient resources or scheduling issues | Check events: `kubectl describe pod <pod-name>`                           |
| Cannot access NodePort service      | Security group missing rule                 | Add inbound rule for port 30080                                           |
| Worker nodes cannot join            | Network connectivity or token expired       | Regenerate token: `kubeadm token create --print-join-command`             |

### Diagnostic Commands

```bash
# Check node status
kubectl get nodes -o wide

# Check all pods across namespaces
kubectl get pods -A

# View cluster events
kubectl get events --sort-by='.lastTimestamp'

# Check kubelet logs
sudo journalctl -u kubelet -f

# Check containerd status
sudo systemctl status containerd

# Verify network connectivity between nodes
ping <OTHER_NODE_PRIVATE_IP>
```

---

## 10. References and Further Reading

1. Kubernetes Official Documentation: https://kubernetes.io/docs/
2. kubeadm Installation Guide: https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/
3. Horizontal Pod Autoscaler Walkthrough: https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/
4. Calico Documentation: https://docs.tigera.io/calico/latest/about/
5. containerd Configuration: https://github.com/containerd/containerd/blob/main/docs/cri/config.md
6. AWS EC2 Instance Types: https://aws.amazon.com/ec2/instance-types/
7. Metrics Server: https://github.com/kubernetes-sigs/metrics-server

---

## Project Repository Structure

```
k8s_autoscaling/
├── src/
│   └── server.ts              # Node.js/TypeScript application server
├── tests/
│   ├── unit/                  # Unit tests
│   └── integration/           # Integration tests
├── Dockerfile                 # Multi-stage Docker build configuration
├── docker-compose.yml         # Local development compose file
├── package.json               # Node.js dependencies and scripts
├── tsconfig.json              # TypeScript compiler configuration
├── jest.config.ts             # Test framework configuration
├── k8s-app.yaml               # Kubernetes Deployment and Service
├── k8s-hpa.yaml               # HorizontalPodAutoscaler configuration
├── k8s-rbac.yaml              # RBAC permissions for dashboard
├── setup_aws_node.sh          # Automated node setup script (Ubuntu)
├── local-setup-ubuntu.sh      # Local prerequisites (Ubuntu)
├── local-setup-fedora.sh      # Local prerequisites (Fedora)
├── local-test.sh              # Automated local testing script
├── load-generator.sh          # HTTP load generation utility
└── README.md                  # This documentation
```

---

## License

This project is released under the MIT License. See the LICENSE file for details.
