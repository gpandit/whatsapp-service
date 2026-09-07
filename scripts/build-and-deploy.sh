#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Build and Deploy Script for WhatsApp Lambda Service
# Usage:
#   ./scripts/build-and-deploy.sh dev     → deploy to dev
#   ./scripts/build-and-deploy.sh prod    → deploy to prod
# ──────────────────────────────────────────────────────────────────────────────

set -e

ENV=${1:-dev}
echo "🚀 Deploying to: $ENV"

# 1. Install and build Lambda
echo "📦 Building Lambda..."
cd lambda
npm install
npx prisma generate
npm run build
cd ..

# 2. Install CDK deps
echo "📦 Installing CDK dependencies..."
cd infrastructure
npm install
cd ..

# 3. Bootstrap CDK (only needed once per account/region)
echo "🏗️  Bootstrapping CDK..."
cd infrastructure
npx cdk bootstrap --context env=$ENV

# 4. Deploy the stack
echo "🚀 Deploying stack..."
npx cdk deploy --context env=$ENV --require-approval never --outputs-file ../cdk-outputs.json
cd ..

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Outputs:"
cat cdk-outputs.json
echo ""
echo "🔑 NEXT STEPS:"
echo "1. Copy your API Gateway URL from cdk-outputs.json"
echo "2. Update admin-ui/app.js → API_BASE = 'https://<your-api-url>/dev'"
echo "3. Set your WhatsApp secrets in AWS Secrets Manager (ARN shown above)"
echo "4. Register the webhook URL in Meta Developer Portal"
echo "5. Create your first admin: see README.md → Step 7"
