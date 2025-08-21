#!/bin/bash
# deploy.sh
# Wrapper script that ensures resources exist and then runs cdk deploy

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Make sure the ensure-resources script is executable
chmod +x "$SCRIPT_DIR/ensure-resources.sh"

echo "=== 🔍 Checking for required AWS resources ==="
"$SCRIPT_DIR/ensure-resources.sh"

echo ""
echo "=== 🚀 Running CDK deployment ==="
cd "$(dirname "$SCRIPT_DIR")"  # Go back to project root
cdk deploy --require-approval never  # Add any additional cdk deploy options here

echo ""
echo "=== ✅ Deployment completed ==="
