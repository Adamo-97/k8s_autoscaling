#!/bin/bash

#######################################################################
# AWS Key Pair Setup
# Creates SSH key pair if it doesn't exist
#######################################################################

set -e

CLUSTER_NAME="${1:-k8s-autoscaling-demo}"
REGION="${2:-us-east-1}"
KEY_NAME="${CLUSTER_NAME}-key"
KEY_FILE="${KEY_NAME}.pem"

echo "[AWS] Setting up SSH Key Pair: $KEY_NAME"

# Check if key file already exists locally
if [ -f "$KEY_FILE" ]; then
    echo "[INFO] Key file $KEY_FILE already exists locally"
    
    # Verify it exists in AWS
    if aws ec2 describe-key-pairs \
        --region "$REGION" \
        --key-names "$KEY_NAME" &> /dev/null; then
        echo "[OK] Key pair verified in AWS"
        echo "$KEY_FILE"
        exit 0
    else
        echo "[WARNING] Local key exists but not found in AWS"
        echo "[WARNING] This may cause issues. Consider renaming local file and creating new key."
        echo "$KEY_FILE"
        exit 0
    fi
fi

# Check if key exists in AWS but not locally
if aws ec2 describe-key-pairs \
    --region "$REGION" \
    --key-names "$KEY_NAME" &> /dev/null; then
    echo "[ERROR] Key pair exists in AWS but .pem file not found locally"
    echo "[ERROR] Cannot retrieve private key from AWS"
    echo "[ERROR] Options:"
    echo "        1. Delete the AWS key pair: aws ec2 delete-key-pair --region $REGION --key-name $KEY_NAME"
    echo "        2. Run this script again to create new key pair"
    exit 1
fi

# Create new key pair
echo "[INFO] Creating new SSH key pair..."
if aws ec2 create-key-pair \
    --region "$REGION" \
    --key-name "$KEY_NAME" \
    --query 'KeyMaterial' \
    --output text > "$KEY_FILE"; then
    
    chmod 400 "$KEY_FILE"
    echo "[OK] Key pair created and saved to: $KEY_FILE"
    echo "[OK] Permissions set to 400"
    echo "$KEY_FILE"
else
    echo "[ERROR] Failed to create key pair"
    exit 1
fi
