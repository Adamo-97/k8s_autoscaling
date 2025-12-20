#!/bin/bash

# Local setup script for Fedora (installs Podman, podman-compose or podman-docker, kubectl, minikube)
# Usage: sudo bash local-setup-fedora.sh
set -e

if [ "$EUID" -ne 0 ]; then
  echo "This script must be run as root. Use: sudo bash local-setup-fedora.sh"
  exit 1
fi

echo "[INFO] Updating dnf repositories..."
dnf -y update

echo "[INFO] Installing Podman and utilities..."
dnf -y install podman podman-docker

# Try to install podman-compose if available; otherwise recommend pip install
if ! command -v podman-compose >/dev/null 2>&1; then
  if dnf list podman-compose >/dev/null 2>&1; then
    dnf -y install podman-compose
    echo "[OK] podman-compose installed from dnf"
  else
    echo "[WARN] podman-compose not available in dnf. Installing via pip..."
    dnf -y install python3-pip
    pip3 install --user podman-compose
    echo "[OK] podman-compose installed for user (~/.local/bin added to PATH may be required)"
  fi
else
  echo "[OK] podman-compose already available"
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

# Ensure conntrack is available
if ! command -v conntrack >/dev/null 2>&1; then
  dnf -y install conntrack
fi

echo "[INFO] Local setup for Fedora complete. You can run:"
echo "  minikube start --driver=podman"
echo "  OR run the project's local test script: bash local-test.sh minikube"
