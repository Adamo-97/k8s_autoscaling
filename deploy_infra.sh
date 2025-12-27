#!/bin/bash

# ==============================================================================
# AWS INFRASTRUCTURE DEPLOYMENT SCRIPT FOR KUBERNETES CLUSTER
# ==============================================================================
# This script provisions 3 EC2 instances for a Kubernetes cluster.
# It automatically configures Security Groups, Key Pairs, and User Data.
#
# PREREQUISITES:
# 1. AWS CLI installed and configured (~/.aws/credentials).
# 2. 'setup_aws_node.sh' must exist in the same directory.
#
# USAGE:
#   bash deploy_infra.sh [OPTIONS]
#
# OPTIONS:
#   --region REGION         AWS region (default: us-east-1)
#   --instance-type TYPE    EC2 instance type (default: t3.medium)
#   --count N               Number of instances (default: 3)
#   --cluster-name NAME     Cluster name prefix (default: k8s-autoscaling-demo)
#   --skip-checks          Skip prerequisite checks
#   --help                 Show this help message
# ==============================================================================

set -e  # Exit on error
set -o pipefail  # Catch errors in pipes

# --- Default Configuration ---
CLUSTER_NAME="k8s-autoscaling-demo"
REGION="us-east-1"
INSTANCE_TYPE="t3.medium"
INSTANCE_COUNT=3
SKIP_CHECKS=0

# --- Parse Arguments ---
while [[ $# -gt 0 ]]; do
    case $1 in
        --region)
            REGION="$2"
            shift 2
            ;;
        --instance-type)
            INSTANCE_TYPE="$2"
            shift 2
            ;;
        --count)
            INSTANCE_COUNT="$2"
            shift 2
            ;;
        --cluster-name)
            CLUSTER_NAME="$2"
            shift 2
            ;;
        --skip-checks)
            SKIP_CHECKS=1
            shift
            ;;
        --help)
            grep "^#" "$0" | grep -v "#!/bin/bash" | sed 's/^# //'
            exit 0
            ;;
        *)
            echo "[ERROR] Unknown option: $1"
            echo "Run with --help for usage information"
            exit 1
            ;;
    esac
done

KEY_NAME="${CLUSTER_NAME}-key"
SG_NAME="${CLUSTER_NAME}-sg"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "==========================================="
echo "   AWS Infrastructure Deployment"
echo "==========================================="
echo "Cluster Name:    $CLUSTER_NAME"
echo "Region:          $REGION"
echo "Instance Type:   $INSTANCE_TYPE"
echo "Instance Count:  $INSTANCE_COUNT"
echo "==========================================="
echo ""

# --- Run prerequisite checks ---
if [ $SKIP_CHECKS -eq 0 ]; then
    if [ -f "aws/check-prerequisites.sh" ]; then
        echo -e "${BLUE}[STEP 0]${NC} Running prerequisite checks..."
        if ! bash aws/check-prerequisites.sh; then
            echo ""
            echo -e "${RED}[ERROR]${NC} Prerequisite checks failed!"
            echo "Fix the issues above or use --skip-checks to bypass"
            exit 1
        fi
        echo ""
    else
        echo -e "${YELLOW}[WARNING]${NC} Prerequisite checker not found, skipping..."
        echo ""
    fi
else
    echo -e "${YELLOW}[WARNING]${NC} Skipping prerequisite checks"
    echo ""
fi

# --- Step 1: Fetch Latest Ubuntu 22.04 AMI ---
echo -e "${BLUE}[STEP 1]${NC} Fetching latest Ubuntu 22.04 AMI..."
AMI_ID=$(aws ec2 describe-images \
    --region "$REGION" \
    --owners 099720109477 \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" "Name=state,Values=available" \
    --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
    --output text 2>/dev/null || echo "")

if [ -z "$AMI_ID" ]; then
    echo -e "${RED}[ERROR]${NC} Failed to fetch Ubuntu AMI. Check your AWS region and credentials."
    exit 1
fi

echo -e "${GREEN}[OK]${NC} AMI Selected: $AMI_ID"
echo ""

# --- Step 2: Setup Key Pair ---
echo -e "${BLUE}[STEP 2]${NC} Setting up SSH key pair..."
if [ -f "aws/setup-keypair.sh" ]; then
    KEY_FILE=$(bash aws/setup-keypair.sh "$CLUSTER_NAME" "$REGION")
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERROR]${NC} Key pair setup failed"
        exit 1
    fi
else
    # Fallback to inline key creation
    if [ ! -f "${KEY_NAME}.pem" ]; then
        echo "[INFO] Creating new SSH Key Pair: ${KEY_NAME}..."
        aws ec2 create-key-pair \
            --region "$REGION" \
            --key-name "$KEY_NAME" \
            --query 'KeyMaterial' \
            --output text > "${KEY_NAME}.pem"
        chmod 400 "${KEY_NAME}.pem"
        echo -e "${GREEN}[OK]${NC} Key saved to: ${KEY_NAME}.pem"
    else
        echo -e "${GREEN}[OK]${NC} Key Pair ${KEY_NAME}.pem already exists"
    fi
    KEY_FILE="${KEY_NAME}.pem"
fi
echo ""

# --- Step 3: Setup Security Group ---
echo -e "${BLUE}[STEP 3]${NC} Setting up security group..."
if [ -f "aws/setup-security-group.sh" ]; then
    SG_ID=$(bash aws/setup-security-group.sh "$CLUSTER_NAME" "$REGION")
    if [ $? -ne 0 ] || [ -z "$SG_ID" ]; then
        echo -e "${RED}[ERROR]${NC} Security group setup failed"
        exit 1
    fi
else
    # Fallback to inline SG creation
    SG_ID=$(aws ec2 create-security-group \
        --region "$REGION" \
        --group-name "$SG_NAME" \
        --description "Kubernetes Autoscaling Demo" \
        --query 'GroupId' \
        --output text 2>/dev/null || \
        aws ec2 describe-security-groups \
            --region "$REGION" \
            --group-names "$SG_NAME" \
            --query 'SecurityGroups[0].GroupId' \
            --output text)
    
    if [ -z "$SG_ID" ]; then
        echo -e "${RED}[ERROR]${NC} Failed to create or retrieve security group"
        exit 1
    fi
    echo -e "${GREEN}[OK]${NC} Security Group: $SG_ID"
fi
echo ""

# --- Step 4: Launch Instances ---
echo -e "${BLUE}[STEP 4]${NC} Launching EC2 instances..."
if [ -f "aws/launch-instances.sh" ]; then
    # Check for existing instances tagged with the cluster name and avoid creating duplicates
    EXISTING_IDS=$(aws ec2 describe-instances \
        --filters "Name=tag:Name,Values=${CLUSTER_NAME}-node" "Name=instance-state-name,Values=running,pending,stopped,stopping" \
        --region "$REGION" \
        --query 'Reservations[*].Instances[*].InstanceId' --output text 2>/dev/null || echo "")

    EXISTING_COUNT=0
    if [ -n "$EXISTING_IDS" ]; then
        EXISTING_COUNT=$(echo "$EXISTING_IDS" | wc -w)
    fi

    if [ "$EXISTING_COUNT" -ge "$INSTANCE_COUNT" ]; then
        echo -e "${YELLOW}[SKIP]${NC} Found $EXISTING_COUNT existing instance(s) matching ${CLUSTER_NAME}-node. No new instances will be launched."
        INSTANCE_IDS="$EXISTING_IDS"
    else
        TO_LAUNCH=$((INSTANCE_COUNT - EXISTING_COUNT))
        echo -e "${BLUE}[INFO]${NC} Found $EXISTING_COUNT existing instance(s); launching $TO_LAUNCH more to reach $INSTANCE_COUNT total..."
        NEW_IDS=$(bash aws/launch-instances.sh "$CLUSTER_NAME" "$REGION" "$INSTANCE_TYPE" "$TO_LAUNCH" "$AMI_ID" "$KEY_NAME" "$SG_ID")
        if [ $? -ne 0 ] || [ -z "$NEW_IDS" ]; then
            echo -e "${RED}[ERROR]${NC} Instance launch failed"
            exit 1
        fi
        if [ -n "$EXISTING_IDS" ]; then
            INSTANCE_IDS="$EXISTING_IDS $NEW_IDS"
        else
            INSTANCE_IDS="$NEW_IDS"
        fi
    fi
else
    # Fallback inline: check for existing instances first to avoid duplicates
    EXISTING_IDS=$(aws ec2 describe-instances \
        --filters "Name=tag:Name,Values=${CLUSTER_NAME}-node" "Name=instance-state-name,Values=running,pending,stopped,stopping" \
        --region "$REGION" \
        --query 'Reservations[*].Instances[*].InstanceId' --output text 2>/dev/null || echo "")

    EXISTING_COUNT=0
    if [ -n "$EXISTING_IDS" ]; then
        EXISTING_COUNT=$(echo "$EXISTING_IDS" | wc -w)
    fi

    if [ "$EXISTING_COUNT" -ge "$INSTANCE_COUNT" ]; then
        echo -e "${YELLOW}[SKIP]${NC} Found $EXISTING_COUNT existing instance(s) matching ${CLUSTER_NAME}-node. No new instances will be launched."
        INSTANCE_IDS="$EXISTING_IDS"
    else
        TO_LAUNCH=$((INSTANCE_COUNT - EXISTING_COUNT))
        echo -e "${BLUE}[INFO]${NC} Found $EXISTING_COUNT existing instance(s); launching $TO_LAUNCH more to reach $INSTANCE_COUNT total..."
        NEW_IDS=$(aws ec2 run-instances \
            --region "$REGION" \
            --image-id "$AMI_ID" \
            --count "$TO_LAUNCH" \
            --instance-type "$INSTANCE_TYPE" \
            --key-name "$KEY_NAME" \
            --security-group-ids "$SG_ID" \
            --user-data file://setup_aws_node.sh \
            --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${CLUSTER_NAME}-node}]" \
            --query 'Instances[*].InstanceId' \
            --output text)

        if [ -z "$NEW_IDS" ]; then
            echo -e "${RED}[ERROR]${NC} Failed to launch instances"
            exit 1
        fi

        if [ -n "$EXISTING_IDS" ]; then
            INSTANCE_IDS="$EXISTING_IDS $NEW_IDS"
        else
            INSTANCE_IDS="$NEW_IDS"
        fi

        echo -e "${GREEN}[OK]${NC} Launched instances: $NEW_IDS"
        echo "[INFO] Waiting for instances to reach 'running' state..."
        aws ec2 wait instance-running --region "$REGION" --instance-ids $NEW_IDS
        echo -e "${GREEN}[OK]${NC} Launched instances are running"
    fi
fi
echo ""

# --- Step 5: Generate Deployment Summary ---
echo "==========================================="
echo "   DEPLOYMENT COMPLETE"
echo "==========================================="
echo ""

# Get instance details
aws ec2 describe-instances \
    --region "$REGION" \
    --instance-ids $INSTANCE_IDS \
    --query 'Reservations[*].Instances[*].{ID:InstanceId, PublicIP:PublicIpAddress, PrivateIP:PrivateIpAddress, State:State.Name}' \
    --output table

echo ""
echo "==========================================="
echo "   NEXT STEPS"
echo "==========================================="
printf '%s\n' ""
printf '%s\n' "1. WAIT: User data script is running in background (3-5 minutes)"
printf '%s\n' "   Installing: containerd, kubeadm, kubelet, kubectl"
printf '%s\n' ""
printf '%s\n' "2. VERIFY: SSH into first node to check installation status:"
FIRST_IP=$(aws ec2 describe-instances \
    --region "$REGION" \
    --instance-ids $INSTANCE_IDS \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text)
printf '%s\n' "   ssh -i $KEY_FILE ubuntu@$FIRST_IP"
printf '%s\n' "   sudo systemctl status kubelet  # Should be active"
printf '%s\n' ""
printf '%s\n' "3. INITIALIZE: On the first node (control plane):"
printf '%s\n' "   sudo kubeadm init --pod-network-cidr=192.168.0.0/16"
printf '%s\n' ""
printf '%s\n' "4. CONFIGURE: After kubeadm init completes:"
printf '%s\n' "   mkdir -p \$HOME/.kube"
printf '%s\n' "   sudo cp -i /etc/kubernetes/admin.conf \$HOME/.kube/config"
printf '%s\n' "   sudo chown \$(id -u):\$(id -g) \$HOME/.kube/config"
printf '%s\n' ""
printf '%s\n' "5. INSTALL CNI: Install Calico network plugin:"
printf '%s\n' "   kubectl apply -f https://docs.projectcalico.org/manifests/calico.yaml"
printf '%s\n' ""
printf '%s\n' "6. JOIN WORKERS: SSH into remaining nodes and run the 'kubeadm join' command"
printf '%s\n' "   from the init output"
printf '%s\n' ""
printf '%s\n' "==========================================="
printf '%s\n' ""
printf '%s\n' "Cluster Name: $CLUSTER_NAME"
printf '%s\n' "Key File:     $KEY_FILE"
printf '%s\n' "Region:       $REGION"
printf '%s\n' ""
printf '%s\n' "To destroy infrastructure: bash teardown_infra.sh"
printf '%s\n' "==========================================="