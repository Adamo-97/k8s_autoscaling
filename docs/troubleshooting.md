# Troubleshooting Guide

This guide provides solutions for common issues encountered when deploying and operating the Kubernetes Autoscaling Demo.

---

## Table of Contents

1. [AWS Deployment Issues](#aws-deployment-issues)
2. [Kubernetes Cluster Issues](#kubernetes-cluster-issues)
3. [HPA and Metrics Issues](#hpa-and-metrics-issues)
4. [Application Issues](#application-issues)
5. [Network Issues](#network-issues)
6. [Diagnostic Commands](#diagnostic-commands)

---

## AWS Deployment Issues

### Prerequisites Check Fails

**Symptom:** `check-prerequisites.sh` reports errors

**Solutions:**

| Error                      | Cause                       | Solution                                             |
| -------------------------- | --------------------------- | ---------------------------------------------------- |
| AWS CLI not found          | CLI not installed           | See [AWS CLI Setup](aws-deployment.md#aws-cli-setup) |
| Credentials not configured | Missing `aws configure`     | Run `aws configure` with valid keys                  |
| Region not set             | Missing default region      | Run `aws configure set region us-east-1`             |
| Missing required files     | setup_aws_node.sh not found | Ensure you're in the project root directory          |

### deploy_infra.sh Hangs

**Symptom:** Script appears stuck during instance launch

**Cause:** User data script takes 3-5 minutes to complete

**Solution:** Wait for completion. The script includes progress indicators. If it truly hangs (>10 minutes), check:

```bash
# Check instance status
aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=k8s-autoscaling-demo-node" \
    --query 'Reservations[*].Instances[*].{ID:InstanceId,State:State.Name}' \
    --output table
```

### Security Group "DependencyViolation" on Teardown

**Symptom:** `teardown_infra.sh` fails to delete security group

**Cause:** Network interfaces take 30-60s to detach after instance termination

**Solution:** The script includes automatic retry logic. If it still fails:

```bash
# Wait 2 minutes, then retry
sleep 120
aws ec2 delete-security-group \
    --group-name k8s-autoscaling-demo-sg \
    --region us-east-1
```

### Key Pair Already Exists

**Symptom:** Error creating key pair

**Solution:**

```bash
# Delete existing key pair
aws ec2 delete-key-pair --key-name k8s-autoscaling-demo-key --region us-east-1
rm -f k8s-autoscaling-demo-key.pem

# Re-run deployment
bash deploy_infra.sh
```

---

## Kubernetes Cluster Issues

### kubeadm init Fails with CPU Error

**Symptom:** Error about insufficient CPUs

**Cause:** Instance has fewer than 2 vCPUs

**Solution:** Use t3.medium or larger instances (minimum 2 vCPUs required)

### Nodes Show "NotReady" Status

**Symptom:** `kubectl get nodes` shows NotReady

**Cause:** CNI not installed or misconfigured

**Solutions:**

1. **Verify Calico is installed:**

   ```bash
   kubectl get pods -n kube-system | grep calico
   ```

2. **If Calico pods are not running, reinstall:**

   ```bash
   kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.26.1/manifests/calico.yaml
   ```

3. **Check for Calico errors:**
   ```bash
   kubectl -n kube-system logs -l k8s-app=calico-node --tail=100
   ```

### Worker Nodes Cannot Join

**Symptom:** `kubeadm join` fails

**Causes and Solutions:**

| Cause                | Solution                                                |
| -------------------- | ------------------------------------------------------- |
| Token expired        | Regenerate: `kubeadm token create --print-join-command` |
| Network connectivity | Verify security group allows internal traffic           |
| Wrong IP address     | Use private IP of control plane, not public             |

### Pods Stuck in "Pending"

**Symptom:** Pods never reach Running state

**Diagnostic:**

```bash
kubectl describe pod <pod-name>
```

**Common causes:**

| Event Message        | Cause                           | Solution                               |
| -------------------- | ------------------------------- | -------------------------------------- |
| "Insufficient cpu"   | Not enough CPU on nodes         | Add nodes or reduce resource requests  |
| "No nodes available" | All nodes cordoned or not ready | Check node status: `kubectl get nodes` |
| "ImagePullBackOff"   | Cannot pull container image     | Verify image name and registry access  |

---

## HPA and Metrics Issues

### HPA Shows `<unknown>` for CPU

**Symptom:** `kubectl get hpa` shows `<unknown>/50%`

**Cause:** Metrics Server not running or not configured correctly

**Solutions:**

1. **Check Metrics Server deployment:**

   ```bash
   kubectl get deployment metrics-server -n kube-system
   kubectl -n kube-system logs -l k8s-app=metrics-server --tail=100
   ```

2. **Reinstall with proper configuration:**

   ```bash
   kubectl -n kube-system scale deployment metrics-server --replicas=0
   kubectl -n kube-system delete rs -l k8s-app=metrics-server --ignore-not-found
   sleep 3

   kubectl -n kube-system patch deployment metrics-server --type='json' -p='[
     {"op":"replace","path":"/spec/template/spec/containers/0/args","value":["--cert-dir=/tmp","--secure-port=443","--kubelet-insecure-tls","--kubelet-preferred-address-types=InternalIP"]}
   ]'

   kubectl -n kube-system scale deployment metrics-server --replicas=1
   ```

3. **Wait and verify:**
   ```bash
   # Wait 30 seconds
   sleep 30
   kubectl top nodes
   kubectl top pods
   ```

### HPA Not Scaling

**Symptom:** Load is high but pod count doesn't increase

**Diagnostic:**

```bash
kubectl describe hpa k8s-autoscaling-hpa
```

**Common causes:**

| Cause                   | Solution                                                |
| ----------------------- | ------------------------------------------------------- |
| Already at maxReplicas  | Check HPA max setting in k8s-hpa.yaml                   |
| Stabilization window    | Wait for stabilization period (default 0s for scale-up) |
| No CPU requests defined | Ensure deployment has `resources.requests.cpu`          |

### Pods Not Getting Metrics

**Symptom:** `kubectl top pods` shows "metrics not available"

**Cause:** Metrics Server cannot reach kubelets

**Solution:** Verify kubelet is accessible:

```bash
# On worker node
sudo systemctl status kubelet
sudo journalctl -u kubelet -f
```

---

## Application Issues

### Dashboard Shows No Pods

**Symptom:** Dashboard pod list is empty

**Cause:** RBAC permissions not applied

**Solution:**

```bash
# Verify ServiceAccount exists
kubectl get sa dashboard-sa

# If missing, apply RBAC
kubectl apply -f k8s-rbac.yaml

# Restart pods to pick up new ServiceAccount
kubectl rollout restart deployment/k8s-autoscaling-app
```

### Container Fails to Start

**Symptom:** Pods in CrashLoopBackOff or Error state

**Diagnostic:**

```bash
kubectl logs <pod-name>
kubectl describe pod <pod-name>
```

**Common causes:**

| Error               | Cause                  | Solution                           |
| ------------------- | ---------------------- | ---------------------------------- |
| "exec format error" | Wrong CPU architecture | Rebuild image for correct platform |
| Port already in use | Container conflict     | Check for port conflicts           |
| Module not found    | Missing dependencies   | Rebuild image with `npm ci`        |

### Health Check Fails

**Symptom:** Pods restart frequently

**Diagnostic:**

```bash
kubectl describe pod <pod-name> | grep -A5 "Liveness"
```

**Solutions:**

- Increase `initialDelaySeconds` if app needs more startup time
- Increase `timeoutSeconds` if health endpoint is slow
- Check application logs for errors

---

## Network Issues

### Cannot Access NodePort Service

**Symptom:** `http://<NODE_IP>:30080` doesn't respond

**Causes and Solutions:**

1. **Security group missing rule:**

   ```bash
   # Add NodePort rule
   aws ec2 authorize-security-group-ingress \
       --group-name k8s-autoscaling-demo-sg \
       --protocol tcp \
       --port 30080 \
       --cidr 0.0.0.0/0
   ```

2. **Service not created:**

   ```bash
   kubectl get svc k8s-autoscaling-demo-service
   # If missing, apply:
   kubectl apply -f k8s-app.yaml
   ```

3. **Pods not ready:**
   ```bash
   kubectl get pods -l app=k8s-autoscaling
   # All should show "Running" and "1/1"
   ```

### Pods Cannot Communicate

**Symptom:** Pod-to-pod networking fails

**Cause:** CNI misconfiguration

**Diagnostic:**

```bash
# Check Calico pods
kubectl -n kube-system get pods -l k8s-app=calico-node

# Check Calico logs
kubectl -n kube-system logs -l k8s-app=calico-node --tail=100
```

---

## Diagnostic Commands

### Quick Health Check

```bash
# Node status
kubectl get nodes -o wide

# All pods across namespaces
kubectl get pods -A

# HPA status
kubectl get hpa

# Recent cluster events
kubectl get events --sort-by='.lastTimestamp' | tail -20
```

### System Component Logs

```bash
# Kubelet logs (run on node)
sudo journalctl -u kubelet -f

# Containerd status (run on node)
sudo systemctl status containerd

# API server logs
kubectl -n kube-system logs -l component=kube-apiserver --tail=100

# Scheduler logs
kubectl -n kube-system logs -l component=kube-scheduler --tail=100
```

### Network Diagnostics

```bash
# Check CNI pods
kubectl -n kube-system get pods -l k8s-app=calico-node

# Test pod-to-pod connectivity
kubectl run test --image=busybox --rm -it --restart=Never -- wget -O- http://<POD_IP>:3000/health

# Check service endpoints
kubectl get endpoints k8s-autoscaling-demo-service
```

### Resource Usage

```bash
# Node resource usage
kubectl top nodes

# Pod resource usage
kubectl top pods

# Detailed pod resources
kubectl describe pod <pod-name> | grep -A10 "Resources:"
```

---

## Common Issues Quick Reference

| Symptom                             | Probable Cause              | Quick Fix                              |
| ----------------------------------- | --------------------------- | -------------------------------------- |
| `kubeadm init` fails with CPU error | Instance < 2 vCPUs          | Use t3.medium or larger                |
| Nodes show `NotReady`               | CNI not installed           | `kubectl apply -f calico.yaml`         |
| HPA shows `<unknown>`               | Metrics Server missing      | Install and configure metrics-server   |
| Pods stuck in `Pending`             | Insufficient resources      | Check `kubectl describe pod` events    |
| Cannot access NodePort              | Security group rule missing | Add port 30080 to security group       |
| Workers cannot join                 | Token expired               | Regenerate with `kubeadm token create` |
| Dashboard shows no pods             | RBAC not applied            | `kubectl apply -f k8s-rbac.yaml`       |

---

## Getting Help

If these solutions don't resolve your issue:

1. **Check Kubernetes documentation:** https://kubernetes.io/docs/
2. **Review kubeadm troubleshooting:** https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/troubleshooting-kubeadm/
3. **Calico troubleshooting:** https://docs.tigera.io/calico/latest/operations/troubleshoot/
4. **Open an issue:** https://github.com/Adamo-97/k8s_autoscaling/issues
