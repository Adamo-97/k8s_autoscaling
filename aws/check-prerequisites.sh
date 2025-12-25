#!/bin/bash

#######################################################################
# AWS Prerequisites Checker
# Validates that all required tools and configurations are in place
# before attempting deployment.
#######################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "==========================================="
echo "   AWS Prerequisites Check"
echo "==========================================="
echo ""

FAILED=0

# Check 1: AWS CLI installed
echo -n "Checking AWS CLI installation... "
if command -v aws &> /dev/null; then
    AWS_VERSION=$(aws --version 2>&1 | awk '{print $1}')
    echo -e "${GREEN}✓${NC} $AWS_VERSION"
else
    echo -e "${RED}✗ NOT FOUND${NC}"
    echo "  Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    FAILED=1
fi

# Check 2: AWS CLI configured
echo -n "Checking AWS credentials... "
if aws sts get-caller-identity &> /dev/null; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    AWS_USER=$(aws sts get-caller-identity --query Arn --output text | awk -F'/' '{print $NF}')
    echo -e "${GREEN}✓${NC} Account: $ACCOUNT_ID, User: $AWS_USER"
else
    echo -e "${RED}✗ NOT CONFIGURED${NC}"
    echo "  Run: aws configure"
    echo "  You'll need: AWS Access Key ID, Secret Access Key, Default region"
    FAILED=1
fi

# Check 3: Required files exist
echo -n "Checking required files... "
MISSING_FILES=()
[ ! -f "setup_aws_node.sh" ] && MISSING_FILES+=("setup_aws_node.sh")

if [ ${#MISSING_FILES[@]} -eq 0 ]; then
    echo -e "${GREEN}✓${NC} All files present"
else
    echo -e "${RED}✗ MISSING FILES${NC}"
    for file in "${MISSING_FILES[@]}"; do
        echo "  - $file"
    done
    FAILED=1
fi

# Check 4: Check AWS region
echo -n "Checking AWS region... "
REGION=${AWS_REGION:-$(aws configure get region 2>/dev/null || echo "")}
if [ -z "$REGION" ]; then
    echo -e "${YELLOW}⚠${NC} No default region set (will use us-east-1)"
else
    echo -e "${GREEN}✓${NC} $REGION"
fi

# Check 5: Test internet connectivity
echo -n "Checking internet connectivity... "
if curl -s --connect-timeout 5 https://checkip.amazonaws.com &> /dev/null; then
    MY_IP=$(curl -s https://checkip.amazonaws.com)
    echo -e "${GREEN}✓${NC} Public IP: $MY_IP"
else
    echo -e "${RED}✗ FAILED${NC}"
    echo "  Cannot reach external services. Check your internet connection."
    FAILED=1
fi

# Check 6: Estimate costs
echo ""
echo "==========================================="
echo "   Cost Estimation"
echo "==========================================="
echo "Instance Type: t3.medium (3 instances)"
echo "Storage: 20GB gp3 per instance"
echo "Estimated Cost: ~\$0.15/hour (~\$3.60/day)"
echo ""
echo -e "${YELLOW}WARNING:${NC} Remember to run teardown_infra.sh when done!"
echo ""

# Final result
echo "==========================================="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All prerequisites met!${NC}"
    echo "==========================================="
    exit 0
else
    echo -e "${RED}✗ Prerequisites check failed!${NC}"
    echo "==========================================="
    echo ""
    echo "Fix the issues above before running deploy_infra.sh"
    exit 1
fi
