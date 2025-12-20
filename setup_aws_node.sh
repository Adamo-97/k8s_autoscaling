#!/bin/bash

#######################################################################
# Kubernetes Node Setup Script for Ubuntu 22.04 LTS
# This script automates the installation and configuration of:
# - containerd runtime
# - kubeadm, kubelet, kubectl
# - Required kernel modules and sysctl settings
#
# Usage: sudo bash setup_aws_node.sh
#######################################################################

set -e

echo "==========================================="
echo "   Kubernetes Node Setup - Ubuntu 22.04   "
echo "==========================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "[ERROR] Please run as root (use sudo)"
    exit 1
fi

echo ""
echo "[STEP 1] Disabling swap..."
swapoff -a
sed -i '/ swap / s/^/#/' /etc/fstab
echo "[OK] Swap disabled"

echo ""
echo "[STEP 2] Loading kernel modules..."
cat <<EOF | tee /etc/modules-load.d/containerd.conf
overlay
br_netfilter
EOF

modprobe overlay
modprobe br_netfilter
echo "[OK] Kernel modules loaded"

echo ""
echo "[STEP 3] Configuring sysctl parameters..."
cat <<EOF | tee /etc/sysctl.d/99-kubernetes-cri.conf
net.bridge.bridge-nf-call-iptables  = 1
net.ipv4.ip_forward                 = 1
net.bridge.bridge-nf-call-ip6tables = 1
EOF

sysctl --system > /dev/null 2>&1
echo "[OK] Sysctl parameters configured"

echo ""
echo "[STEP 4] Installing containerd..."
apt-get update -qq
apt-get install -y -qq apt-transport-https ca-certificates curl software-properties-common

# Install Docker's official GPG key and repository for containerd
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -qq
apt-get install -y -qq containerd.io
echo "[OK] containerd installed"

echo ""
echo "[STEP 5] Configuring containerd with SystemdCgroup..."
mkdir -p /etc/containerd
containerd config default | tee /etc/containerd/config.toml > /dev/null

# Critical: Enable SystemdCgroup
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

systemctl restart containerd
systemctl enable containerd
echo "[OK] containerd configured and started"

echo ""
echo "[STEP 6] Installing kubeadm, kubelet, kubectl..."
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.28/deb/Release.key | gpg --dearmor -o /usr/share/keyrings/kubernetes-apt-keyring.gpg

echo 'deb [signed-by=/usr/share/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.28/deb/ /' | tee /etc/apt/sources.list.d/kubernetes.list

apt-get update -qq
apt-get install -y -qq kubelet kubeadm kubectl
apt-mark hold kubelet kubeadm kubectl
echo "[OK] Kubernetes components installed and held"

echo ""
echo "[STEP 7] Enabling kubelet service..."
systemctl enable kubelet
echo "[OK] kubelet enabled"

echo ""
echo "==========================================="
echo "[SUCCESS] Setup Complete!"
echo "==========================================="
echo ""
echo "Next Steps:"
echo ""
echo "[MASTER] For MASTER node:"
echo "   sudo kubeadm init --pod-network-cidr=192.168.0.0/16"
echo ""
echo "[WORKER] For WORKER nodes:"
echo "   Use the 'kubeadm join' command from master node output"
echo ""
echo "[CONFIG] After init on master, run:"
echo "   sudo chown \$(id -u):\$(id -g) \$HOME/.kube/config"
echo ""
echo "==========================================="
