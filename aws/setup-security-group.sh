#!/bin/bash

#######################################################################
# AWS Security Group Setup
# Creates and configures security group with all required rules
#######################################################################

set -e

CLUSTER_NAME="${1:-k8s-autoscaling-demo}"
REGION="${2:-us-east-1}"
SG_NAME="${CLUSTER_NAME}-sg"

echo "[AWS] Setting up Security Group: $SG_NAME"

# Try to create security group
SG_ID=$(aws ec2 create-security-group \
    --region "$REGION" \
    --group-name "$SG_NAME" \
    --description "Kubernetes Autoscaling Demo - Auto-generated" \
    --query 'GroupId' \
    --output text 2>/dev/null || echo "")

if [ -z "$SG_ID" ]; then
    # Security group already exists, get its ID
    SG_ID=$(aws ec2 describe-security-groups \
        --region "$REGION" \
        --group-names "$SG_NAME" \
        --query 'SecurityGroups[0].GroupId' \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$SG_ID" ]; then
        echo "[ERROR] Failed to create or retrieve security group"
        exit 1
    fi
    echo "[INFO] Using existing Security Group: $SG_ID"
else
    echo "[INFO] Created new Security Group: $SG_ID"
fi

# Get current public IP for SSH access
echo "[INFO] Fetching your public IP..."
MY_IP=$(curl -s --connect-timeout 10 https://checkip.amazonaws.com || echo "")
if [ -z "$MY_IP" ]; then
    echo "[WARNING] Could not determine public IP. SSH rule will not be added."
    echo "[WARNING] You may need to manually add SSH access to the security group."
else
    echo "[INFO] Your public IP: $MY_IP"
fi

# Function to add ingress rule (idempotent)
add_rule() {
    local protocol=$1
    local port=$2
    local cidr=$3
    local description=$4
    
    # Check if rule already exists
    EXISTING=$(aws ec2 describe-security-groups \
        --region "$REGION" \
        --group-ids "$SG_ID" \
        --query "SecurityGroups[0].IpPermissions[?IpProtocol=='$protocol' && FromPort==\`$port\`].IpRanges[?CidrIp=='$cidr'].CidrIp" \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$EXISTING" ]; then
        echo "[SKIP] Rule already exists: $description"
        return 0
    fi
    
    # Add the rule
    if aws ec2 authorize-security-group-ingress \
        --region "$REGION" \
        --group-id "$SG_ID" \
        --protocol "$protocol" \
        --port "$port" \
        --cidr "$cidr" \
        --output text &> /dev/null; then
        echo "[OK] Added rule: $description"
    else
        echo "[WARNING] Failed to add rule: $description (may already exist)"
    fi
}

# Add security group rules
echo "[INFO] Configuring firewall rules..."

# Rule 1: SSH from your IP (if available)
if [ -n "$MY_IP" ]; then
    add_rule "tcp" "22" "${MY_IP}/32" "SSH from your IP ($MY_IP)"
else
    echo "[WARNING] Skipping SSH rule - IP detection failed"
fi

# Rule 2: NodePort for dashboard access
add_rule "tcp" "30080" "0.0.0.0/0" "NodePort 30080 - Dashboard access"

# Rule 3: Self-referencing rule for internal cluster communication
# This requires a different command structure
echo "[INFO] Adding internal cluster communication rule..."
SELF_RULE_EXISTS=$(aws ec2 describe-security-groups \
    --region "$REGION" \
    --group-ids "$SG_ID" \
    --query "SecurityGroups[0].IpPermissions[?UserIdGroupPairs[0].GroupId=='$SG_ID'].IpProtocol" \
    --output text 2>/dev/null || echo "")

if [ -z "$SELF_RULE_EXISTS" ]; then
    if aws ec2 authorize-security-group-ingress \
        --region "$REGION" \
        --group-id "$SG_ID" \
        --protocol all \
        --source-group "$SG_ID" \
        --output text &> /dev/null; then
        echo "[OK] Added rule: Internal cluster communication"
    else
        echo "[WARNING] Failed to add internal communication rule (may already exist)"
    fi
else
    echo "[SKIP] Internal communication rule already exists"
fi

echo "[SUCCESS] Security Group configured: $SG_ID"
echo "$SG_ID"  # Output SG_ID for use by calling script
