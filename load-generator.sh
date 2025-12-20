#!/bin/bash

#######################################################################
# Load Generator Script
# Generates HTTP load to trigger HPA autoscaling
#
# Usage: bash load-generator.sh [URL] [requests] [concurrent]
# Examples:
#   bash load-generator.sh http://localhost:3000 100 10
#   bash load-generator.sh $(minikube service k8s-autoscaling-service --url) 200 20
#   bash load-generator.sh http://NODE_IP:30080 150 15
#######################################################################

URL=${1:-http://localhost:3000}
REQUESTS=${2:-100}
CONCURRENT=${3:-10}

echo "==========================================="
echo "   Load Generator for K8s Autoscaling"
echo "==========================================="
echo ""
echo "Target URL:        $URL"
echo "Total Requests:    $REQUESTS"
echo "Concurrent:        $CONCURRENT"
echo "-------------------------------------------"
echo ""

if ! command -v curl >/dev/null 2>&1; then
    echo "Error: curl is required but not installed."
    exit 1
fi

echo "Starting load generation at $(date)"
echo ""

# Function to make requests
make_requests() {
    local count=$1
    for i in $(seq 1 $count); do
        curl -s -o /dev/null -w "Request %{http_code} - Time: %{time_total}s\n" --max-time 10 "${URL}/cpu-load" &
        sleep 0.1
    done
}

# Calculate requests per batch
BATCH_SIZE=$(($REQUESTS / $CONCURRENT))
REMAINDER=$(($REQUESTS % $CONCURRENT))

# Run concurrent batches
for batch in $(seq 1 $CONCURRENT); do
    if [ $batch -le $REMAINDER ]; then
        make_requests $(($BATCH_SIZE + 1)) &
    else
        make_requests $BATCH_SIZE &
    fi
done

# Wait for all background jobs
wait

echo ""
echo "Load generation completed at $(date)"
echo ""
echo "Next steps:"
echo "1. Monitor HPA: watch kubectl get hpa"
echo "2. Monitor pods: watch kubectl get pods"
echo "3. Check metrics: kubectl top pods"
echo ""
