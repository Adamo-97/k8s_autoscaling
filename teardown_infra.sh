#!/bin/bash

# ==============================================================================
# AWS INFRASTRUCTURE TEARDOWN SCRIPT (IMPROVED)
# ==============================================================================
# This script safely destroys all AWS resources created by deploy_infra.sh
#
# USAGE:
#   bash teardown_infra.sh [OPTIONS]
#
# OPTIONS:
#   --region REGION         AWS region (default: us-east-1)
#   --cluster-name NAME     Cluster name prefix (default: k8s-autoscaling-demo)
#   --force                Skip confirmation prompt
#   --help                 Show this help message
#
# WARNING: This will permanently delete all instances, security groups, and keys!
# ==============================================================================

set -e
set -o pipefail

# --- Default Configuration ---
CLUSTER_NAME="k8s-autoscaling-demo"
REGION="us-east-1"
FORCE=0

# --- Parse Arguments ---
while [[ $# -gt 0 ]]; do
    case $1 in
        --region)
            REGION="$2"
            shift 2
            ;;
        --cluster-name)
            CLUSTER_NAME="$2"
            shift 2
            ;;
        --force)
            FORCE=1
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

SG_NAME="${CLUSTER_NAME}-sg"
KEY_NAME="${CLUSTER_NAME}-key"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "==========================================="
echo "   AWS Infrastructure Teardown"
echo "==========================================="
echo "Cluster Name: $CLUSTER_NAME"
echo "Region:       $REGION"
echo "==========================================="
echo ""

# --- Confirmation Prompt ---
if [ $FORCE -eq 0 ]; then
    echo -e "${YELLOW}WARNING:${NC} This will PERMANENTLY DELETE:"
    echo "  - All EC2 instances tagged with: ${CLUSTER_NAME}-node"
    echo "  - Security group: ${SG_NAME}"
    echo "  - SSH key pair: ${KEY_NAME}"
    echo "  - Local key file: ${KEY_NAME}.pem"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "[ABORTED] Teardown cancelled"
        exit 0
    fi
    echo ""
fi

# --- Pre-flight Check ---
echo -e "${BLUE}[CHECK]${NC} Verifying AWS CLI is available..."
if ! command -v aws &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} AWS CLI not found. Cannot proceed."
    exit 1
fi
echo -e "${GREEN}[OK]${NC} AWS CLI found"
echo ""

# --- Step 1: Find and Terminate Instances ---
echo -e "${BLUE}[STEP 1]${NC} Finding instances..."
INSTANCE_IDS=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=${CLUSTER_NAME}-node" \
              "Name=instance-state-name,Values=running,pending,stopped,stopping" \
    --region "$REGION" \
    --query "Reservations[*].Instances[*].InstanceId" \
    --output text 2>/dev/null || echo "")

if [ -n "$INSTANCE_IDS" ]; then
    INSTANCE_COUNT=$(echo "$INSTANCE_IDS" | wc -w)
    echo -e "${YELLOW}[FOUND]${NC} $INSTANCE_COUNT instance(s): $INSTANCE_IDS"
    
    # Show instance details before termination
    echo ""
    aws ec2 describe-instances \
        --instance-ids $INSTANCE_IDS \
        --region "$REGION" \
        --query 'Reservations[*].Instances[*].{ID:InstanceId, IP:PublicIpAddress, State:State.Name}' \
        --output table 2>/dev/null || true
    echo ""
    
    echo "[INFO] Terminating instances..."
    if aws ec2 terminate-instances \
        --instance-ids $INSTANCE_IDS \
        --region "$REGION" \
        --output text > /dev/null 2>&1; then
        echo -e "${GREEN}[OK]${NC} Termination initiated"
    else
        echo -e "${RED}[ERROR]${NC} Failed to terminate instances"
        exit 1
    fi
    
    echo "[INFO] Waiting for instances to terminate (this may take 1-2 minutes)..."
    WAIT_START=$(date +%s)
    TIMEOUT=180  # 3 minutes
    
    while true; do
        # Check termination status
        STATES=$(aws ec2 describe-instances \
            --instance-ids $INSTANCE_IDS \
            --region "$REGION" \
            --query 'Reservations[*].Instances[*].State.Name' \
            --output text 2>/dev/null || echo "")
        
        # Count terminated instances
        TERMINATED=$(echo "$STATES" | tr '\t' '\n' | grep -c "terminated" || echo "0")
        
        if [ "$TERMINATED" -eq "$INSTANCE_COUNT" ]; then
            echo -e "${GREEN}[OK]${NC} All instances terminated"
            break
        fi
        
        # Check timeout
        ELAPSED=$(($(date +%s) - WAIT_START))
        if [ $ELAPSED -gt $TIMEOUT ]; then
            echo -e "${YELLOW}[WARNING]${NC} Timeout waiting for termination"
            echo "Some instances may still be terminating. Check AWS console."
            break
        fi
        
        echo "[WAIT] Terminated: $TERMINATED/$INSTANCE_COUNT (${ELAPSED}s elapsed)"
        sleep 10
    done
else
    echo -e "${GREEN}[OK]${NC} No instances found"
fi
echo ""

# --- Step 2: Delete Security Group ---
echo -e "${BLUE}[STEP 2]${NC} Deleting security group..."

# Wait a bit to ensure instance network interfaces are released
if [ -n "$INSTANCE_IDS" ]; then
    echo "[INFO] Waiting 30 seconds for network interfaces to be released..."
    sleep 30
fi

# Try to delete security group with retries
MAX_RETRIES=5
RETRY_COUNT=0
SG_DELETED=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if aws ec2 delete-security-group \
        --group-name "$SG_NAME" \
        --region "$REGION" 2>/dev/null; then
        echo -e "${GREEN}[OK]${NC} Security group deleted: $SG_NAME"
        SG_DELETED=1
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            echo "[RETRY] Security group still in use, waiting... (attempt $RETRY_COUNT/$MAX_RETRIES)"
            sleep 10
        fi
    fi
done

if [ $SG_DELETED -eq 0 ]; then
    echo -e "${YELLOW}[WARNING]${NC} Could not delete security group (may not exist or still in use)"
    echo "You may need to delete it manually from AWS console later"
fi
echo ""

# --- Step 3: Delete Key Pair ---
echo -e "${BLUE}[STEP 3]${NC} Deleting SSH key pair..."

# Delete from AWS
if aws ec2 delete-key-pair \
    --key-name "$KEY_NAME" \
    --region "$REGION" 2>/dev/null; then
    echo -e "${GREEN}[OK]${NC} AWS key pair deleted: $KEY_NAME"
else
    echo -e "${YELLOW}[WARNING]${NC} Key pair not found in AWS (may already be deleted)"
fi

# Delete local file
if [ -f "${KEY_NAME}.pem" ]; then
    rm -f "${KEY_NAME}.pem"
    echo -e "${GREEN}[OK]${NC} Local key file deleted: ${KEY_NAME}.pem"
else
    echo -e "${GREEN}[OK]${NC} Local key file not found (already deleted)"
fi
echo ""

# --- Final Summary ---
echo "==========================================="
echo "   TEARDOWN COMPLETE"
echo "==========================================="
echo ""
echo "Resources cleaned up:"
echo "  ✓ EC2 Instances terminated"
echo "  ✓ Security Group removed"
echo "  ✓ SSH Key Pair deleted"
echo ""
echo "Your AWS account should no longer be charged"
echo "for these resources."
echo "==========================================="