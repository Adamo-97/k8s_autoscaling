# AWS Deployment Guide

This guide provides comprehensive instructions for deploying the Kubernetes cluster on AWS EC2 infrastructure.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [AWS CLI Setup](#aws-cli-setup)
3. [Automated Deployment](#automated-deployment)
4. [Cluster Initialization](#cluster-initialization)
5. [Application Deployment](#application-deployment)
6. [Verification](#verification)
7. [Cost Management](#cost-management)
8. [Cleanup](#cleanup)

---

## Prerequisites

### Required Tools

| Tool    | Version | Purpose                  | Installation                        |
| ------- | ------- | ------------------------ | ----------------------------------- |
| AWS CLI | 2.x     | AWS resource management  | See [AWS CLI Setup](#aws-cli-setup) |
| Docker  | 20+     | Container image building | `local-setup-ubuntu.sh`             |
| Git     | 2.x     | Repository cloning       | `apt install git`                   |

### AWS Infrastructure Requirements

| Component        | Specification                   | Purpose                                          |
| ---------------- | ------------------------------- | ------------------------------------------------ |
| Instance Type    | t3.medium (2 vCPUs, 4GB RAM)    | Minimum for Kubernetes; kubeadm requires 2 vCPUs |
| Instance Count   | 3 (1 control plane + 2 workers) | High availability for pod distribution           |
| Operating System | Ubuntu 22.04 LTS                | Long-term support, tested compatibility          |
| Storage          | 20GB gp3 SSD per instance       | OS + container images + logs                     |
| Region           | us-east-1 (recommended)         | Cost-effective, widely available                 |

### Security Group Configuration

The deployment script creates a security group with these rules:

| Rule Name        | Port(s)   | Source         | Purpose                            |
| ---------------- | --------- | -------------- | ---------------------------------- |
| SSH              | 22/TCP    | Your IP only   | Administrative access              |
| NodePort         | 30080/TCP | 0.0.0.0/0      | Dashboard access                   |
| Internal Cluster | All       | Self-reference | Kubernetes component communication |

### Complete Port Reference

#### Control Plane Ports

| Port      | Protocol | Component       | Required For                       |
| --------- | -------- | --------------- | ---------------------------------- |
| 6443      | TCP      | kube-apiserver  | Kubernetes API (all cluster comms) |
| 2379-2380 | TCP      | etcd            | Cluster state storage              |
| 10250     | TCP      | kubelet         | Node agent API                     |
| 10259     | TCP      | kube-scheduler  | Scheduler metrics                  |
| 10257     | TCP      | kube-controller | Controller manager metrics         |

#### Worker Node Ports

| Port        | Protocol | Component         | Required For                |
| ----------- | -------- | ----------------- | --------------------------- |
| 10250       | TCP      | kubelet           | Node agent API              |
| 30000-32767 | TCP      | NodePort Services | External application access |

#### CNI (Calico) Ports

| Port | Protocol | Component | Required For            |
| ---- | -------- | --------- | ----------------------- |
| 179  | TCP      | BGP       | Pod network routing     |
| 4789 | UDP      | VXLAN     | Overlay network traffic |

---

## AWS CLI Setup

### Installing AWS CLI

**Check if installed:**

```bash
aws --version
# Expected: aws-cli/2.x.x Python/3.x.x Linux/x86_64
```

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

### Configuring Credentials

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

Enter:

```
AWS Access Key ID [None]: AKIAIOSFODNN7EXAMPLE
AWS Secret Access Key [None]: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
Default region name [None]: us-east-1
Default output format [None]: json
```

**Step 3: Verify Configuration**

```bash
aws sts get-caller-identity
```

Expected output:

```json
{
  "UserId": "AIDAJEXAMPLEID",
  "Account": "123456789012",
  "Arn": "arn:aws:iam::123456789012:user/your-username"
}
```

### Running Prerequisites Check

```bash
bash aws/check-prerequisites.sh
```

This script validates:

- ✓ AWS CLI installation
- ✓ AWS credentials configuration
- ✓ Required files (setup_aws_node.sh)
- ✓ AWS region configuration
- ✓ Internet connectivity
- ✓ Cost estimation

---

## Automated Deployment

### Step 1: Prepare Docker Image

```bash
# Build the production image
docker build -t YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest .

# Push to Docker Hub
docker login
docker push YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo:latest

# Update manifest with your username
sed -i 's|adamabd97/k8s-autoscaling-demo|YOUR_DOCKERHUB_USERNAME/k8s-autoscaling-demo|g' k8s-app.yaml
```

### Step 2: Run Deployment Script

```bash
# Basic deployment (uses defaults)
bash deploy_infra.sh

# Custom deployment
bash deploy_infra.sh \
  --region us-west-2 \
  --instance-type t3.large \
  --count 3 \
  --cluster-name my-k8s-cluster

# View all options
bash deploy_infra.sh --help
```

**What happens:**

1. Validates AWS CLI and credentials
2. Creates SSH key pair (saves `.pem` locally)
3. Creates and configures security group
4. Launches 3 EC2 instances with user data script
5. Waits for instances to reach "running" state
6. Displays instance IPs and next steps

**Expected output:**

```
===========================================
   DEPLOYMENT COMPLETE
===========================================

Control Plane IP: 54.123.45.67
Worker 1 IP:      54.123.45.68
Worker 2 IP:      54.123.45.69

Key File: k8s-autoscaling-demo-key.pem
```

**Deployment time:** 5-7 minutes total

---

## Cluster Initialization

### Step 3: Initialize Control Plane

SSH into the control plane instance:

```bash
chmod 400 k8s-autoscaling-demo-key.pem
ssh -i k8s-autoscaling-demo-key.pem ubuntu@<CONTROL_PLANE_IP>
```

Initialize Kubernetes:

```bash
# Initialize the cluster
sudo kubeadm init --pod-network-cidr=192.168.0.0/16

# Configure kubectl
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# Install Calico CNI
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.26.1/manifests/calico.yaml

# Wait for system pods
kubectl get pods -n kube-system --watch
# Press Ctrl+C when all pods show "Running"
```

**Save the join command** from the `kubeadm init` output:

```bash
kubeadm join 172.31.x.x:6443 --token abc123... --discovery-token-ca-cert-hash sha256:def456...
```

### Step 4: Join Worker Nodes

SSH to each worker and run the join command:

```bash
# Terminal 2: Worker 1
ssh -i k8s-autoscaling-demo-key.pem ubuntu@<WORKER_1_IP>
sudo <PASTE_JOIN_COMMAND_HERE>

# Terminal 3: Worker 2
ssh -i k8s-autoscaling-demo-key.pem ubuntu@<WORKER_2_IP>
sudo <PASTE_JOIN_COMMAND_HERE>
```

Verify on control plane:

```bash
kubectl get nodes
# All nodes should show "Ready"
```

### Step 5: Install Metrics Server

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Patch for self-managed clusters
kubectl -n kube-system scale deployment metrics-server --replicas=0
kubectl -n kube-system delete rs -l k8s-app=metrics-server --ignore-not-found
kubectl -n kube-system delete pod -l k8s-app=metrics-server --ignore-not-found
sleep 3

kubectl -n kube-system patch deployment metrics-server --type='json' -p='[
  {"op":"replace","path":"/spec/template/spec/containers/0/ports","value":[{"containerPort":443,"name":"https","protocol":"TCP"}]},
  {"op":"replace","path":"/spec/template/spec/containers/0/args","value":["--cert-dir=/tmp","--secure-port=443","--kubelet-insecure-tls","--kubelet-preferred-address-types=InternalIP"]}
]'

kubectl -n kube-system scale deployment metrics-server --replicas=1
kubectl -n kube-system rollout status deployment/metrics-server --timeout=3m
```

Verify:

```bash
kubectl top nodes
kubectl get hpa  # Should show numeric values, not <unknown>
```

---

## Application Deployment

### Step 6: Deploy Application

```bash
# Clone repo on control plane (or copy manifests)
git clone https://github.com/Adamo-97/k8s_autoscaling.git
cd k8s_autoscaling

# Deploy RBAC, application, and HPA
kubectl apply -f k8s-rbac.yaml
kubectl apply -f k8s-app.yaml
kubectl apply -f k8s-hpa.yaml

# Verify
kubectl get pods
kubectl get hpa
kubectl get svc
```

### Access Dashboard

```
http://<ANY_NODE_PUBLIC_IP>:30080
```

---

## Verification

### Testing Autoscaling

1. Open dashboard: `http://<NODE_IP>:30080`
2. Click "Start CPU Load" button
3. Watch HPA scale pods from 1 → 10 replicas
4. Observe real-time pod creation in dashboard

### Monitoring Commands

```bash
# Watch HPA and pods
watch -n 1 'kubectl get hpa,pods -o wide'

# View HPA events
kubectl describe hpa k8s-autoscaling-hpa

# View pod metrics
kubectl top pods

# View node metrics
kubectl top nodes
```

### Expected Scaling Timeline

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

---

## Cost Management

### Cost Estimation

| Resource            | Hourly Cost (us-east-1) | Daily Cost | Monthly Cost |
| ------------------- | ----------------------- | ---------- | ------------ |
| t3.medium (x3)      | $0.1248                 | $2.99      | $91.10       |
| EBS gp3 20GB (x3)   | ~$0.01                  | ~$0.16     | $4.80        |
| **Total Estimated** | ~$0.15/hour             | ~$3.60/day | ~$96/month   |

### Cost-Saving Tips

1. **Run teardown immediately** after testing
2. **Use us-east-1** for lowest prices
3. **Set billing alerts** in AWS Console
4. **Don't leave clusters running** overnight

---

## Cleanup

### Automated Teardown

```bash
bash teardown_infra.sh
```

This script:

1. Terminates all EC2 instances
2. Deletes security group
3. Deletes SSH key pair
4. Removes local `.pem` file

### Verification

```bash
# Check no instances remain
aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=k8s-autoscaling-demo-node" \
    --query 'Reservations[*].Instances[*].{ID:InstanceId,State:State.Name}' \
    --output table

# Check no security groups remain
aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=k8s-autoscaling-demo-sg" \
    --output table
```

---

## Next Steps

- [Architecture Reference](architecture.md) - Understand the system design
- [Troubleshooting Guide](troubleshooting.md) - Resolve common issues
- [Local Development](local-development.md) - Test locally before deploying
