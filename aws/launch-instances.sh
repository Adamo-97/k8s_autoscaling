#!/bin/bash

#######################################################################
# AWS EC2 Instance Launcher
# Launches EC2 instances and waits for them to be ready
#######################################################################

set -e

CLUSTER_NAME="${1:-k8s-autoscaling-demo}"
REGION="${2:-us-east-1}"
INSTANCE_TYPE="${3:-t3.medium}"
INSTANCE_COUNT="${4:-3}"
AMI_ID="$5"
KEY_NAME="$6"
SG_ID="$7"

if [ -z "$AMI_ID" ] || [ -z "$KEY_NAME" ] || [ -z "$SG_ID" ]; then
    echo "[ERROR] Missing required parameters"
    echo "Usage: $0 CLUSTER_NAME REGION INSTANCE_TYPE COUNT AMI_ID KEY_NAME SG_ID"
    exit 1
fi

echo "[AWS] Launching $INSTANCE_COUNT EC2 instances..."
echo "      Instance Type: $INSTANCE_TYPE"
echo "      AMI: $AMI_ID"
echo "      Security Group: $SG_ID"
echo "      Key Name: $KEY_NAME"

# Check if setup_aws_node.sh exists
if [ ! -f "setup_aws_node.sh" ]; then
    echo "[ERROR] setup_aws_node.sh not found in current directory"
    exit 1
fi

# Launch instances
echo "[INFO] Launching instances with user data script..."
INSTANCE_IDS=$(aws ec2 run-instances \
    --region "$REGION" \
    --image-id "$AMI_ID" \
    --count "$INSTANCE_COUNT" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --user-data file://setup_aws_node.sh \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${CLUSTER_NAME}-node},{Key=Project,Value=${CLUSTER_NAME}}]" \
    --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
    --query 'Instances[*].InstanceId' \
    --output text)

if [ -z "$INSTANCE_IDS" ]; then
    echo "[ERROR] Failed to launch instances"
    exit 1
fi

echo "[OK] Launched instances: $INSTANCE_IDS"

# Wait for instances to reach running state
echo "[INFO] Waiting for instances to reach 'running' state..."
echo "       This typically takes 30-60 seconds..."

if ! aws ec2 wait instance-running \
    --region "$REGION" \
    --instance-ids $INSTANCE_IDS; then
    echo "[ERROR] Timeout waiting for instances to start"
    exit 1
fi

echo "[OK] All instances are now running"

# Wait additional time for system status checks
echo "[INFO] Waiting for system status checks to pass..."
echo "       This typically takes 2-3 minutes..."

WAIT_START=$(date +%s)
TIMEOUT=300  # 5 minutes

while true; do
    # Check status of all instances
    STATUS=$(aws ec2 describe-instance-status \
        --region "$REGION" \
        --instance-ids $INSTANCE_IDS \
        --query 'InstanceStatuses[*].[SystemStatus.Status,InstanceStatus.Status]' \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$STATUS" ]; then
        echo "[WAIT] Status checks not available yet..."
        sleep 10
        continue
    fi
    
    # Count how many instances are fully OK
    OK_COUNT=$(echo "$STATUS" | grep -c "ok.*ok" || echo "0")
    
    if [ "$OK_COUNT" -eq "$INSTANCE_COUNT" ]; then
        echo "[OK] All system status checks passed"
        break
    fi
    
    # Check timeout
    ELAPSED=$(($(date +%s) - WAIT_START))
    if [ $ELAPSED -gt $TIMEOUT ]; then
        echo "[WARNING] Timeout waiting for status checks (${TIMEOUT}s exceeded)"
        echo "[WARNING] Instances may still be initializing. Check AWS console."
        break
    fi
    
    echo "[WAIT] Status checks: $OK_COUNT/$INSTANCE_COUNT passed (${ELAPSED}s elapsed)"
    sleep 15
done

# Wait for user data script to complete (background setup)
echo "[INFO] Waiting for user data script (setup_aws_node.sh) to complete..."
echo "       This typically takes 3-5 minutes..."
echo "       Progress: Installing containerd, kubeadm, kubelet, kubectl..."

sleep 180  # Give it 3 minutes minimum

echo "[OK] Background setup should be complete or nearly complete"

# Output instance IDs for calling script
echo "$INSTANCE_IDS"
