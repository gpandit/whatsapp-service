#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Run Prisma migrations on the RDS database
# Because RDS is in a private VPC, we can't connect to it directly from local.
# This script temporarily opens a Session Manager tunnel or uses a Lambda invoke.
#
# Option A: Run via AWS Lambda (easiest for initial deploy)
# Option B: AWS Systems Manager Session Manager port-forwarding
# ──────────────────────────────────────────────────────────────────────────────
set -e

ENV=${1:-dev}
FUNCTION_NAME="whatsapp-${ENV}-handler"

echo "🗄️  Running migrations via Lambda invoke..."

# Invoke the Lambda with a special migration payload
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --payload '{"__migrate": true}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/migration-response.json

cat /tmp/migration-response.json
echo ""
echo "✅ Migration complete"
