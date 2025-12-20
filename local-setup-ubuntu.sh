#!/bin/bash

# Local setup script for Ubuntu (installs Docker, Docker Compose plugin, kubectl, minikube)
# Usage: sudo bash local-setup-ubuntu.sh
set -e

if [ "$EUID" -ne 0 ]; then
  echo "This script must be run as root. Use: sudo bash local-setup-ubuntu.sh"
  exit 1
fi

echo "[INFO] Updating apt repositories..."
apt-get update -y

echo "[INFO] Installing prerequisites..."
apt-get install -y ca-certificates curl gnupg lsb-release apt-transport-https

# Install Docker Engine
if ! command -v docker >/dev/null 2>&1; then
  echo "[INFO] Installing Docker Engine..."
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
  echo "[OK] Docker installed"
else
  echo "[OK] Docker already installed"
fi

# Install kubectl (binary)
if ! command -v kubectl >/dev/null 2>&1; then
  echo "[INFO] Installing kubectl..."
  KUBECTL_VERSION=$(curl -L -s https://dl.k8s.io/release/stable.txt)
  curl -LO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"
  install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
  rm kubectl
  echo "[OK] kubectl installed"
else
  echo "[OK] kubectl already installed"
fi

# Install minikube
if ! command -v minikube >/dev/null 2>&1; then
  echo "[INFO] Installing minikube..."
  curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
  install minikube-linux-amd64 /usr/local/bin/minikube
  rm minikube-linux-amd64
  echo "[OK] minikube installed"
else
  echo "[OK] minikube already installed"
fi

# Ensure conntrack is available (required by many CNIs)
if ! command -v conntrack >/dev/null 2>&1; then
  apt-get install -y conntrack
fi

echo "[INFO] Local setup for Ubuntu complete. You can run:"
echo "  minikube start --driver=docker"
echo "  OR run the project's local test script: bash local-test.sh minikube"
