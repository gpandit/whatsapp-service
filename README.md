# WhatsApp Messaging Service — Complete Setup & Deployment Guide

A production-ready Node.js service deployed on **AWS Lambda** with **PostgreSQL on RDS**, integrated with the **Meta WhatsApp Cloud API**. Includes an Admin Dashboard for sending messages and an OTP API for system-to-system use.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Your Application                             │
│  (calls POST /otp/send + /otp/verify with x-api-key header)        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│                    Amazon API Gateway                               │
│                 (REST API, HTTPS endpoint)                          │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│                    AWS Lambda (Node.js 20)                          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │  /webhook   │  │ /otp/send    │  │  /messages/send           │  │
│  │  (Meta WA)  │  │ /otp/verify  │  │  /messages/broadcast      │  │
│  └─────────────┘  └──────────────┘  │  /customers               │  │
│                                     │  /templates               │  │
│                                     └───────────────────────────┘  │
└────────────┬─────────────────────────────────┬─────────────────────┘
             │                                 │
┌────────────▼──────────┐        ┌─────────────▼──────────────────────┐
│  RDS PostgreSQL        │        │   Meta WhatsApp Cloud API           │
│  (Private Subnet)      │        │   graph.facebook.com/v18.0          │
│  Free Tier: t3.micro   │        └────────────────────────────────────┘
└───────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Admin Dashboard (S3 + CloudFront)                                  │
│  - Send individual messages                                         │
│  - Run broadcast campaigns                                          │
│  - View message logs & delivery status                              │
│  - Manage customers & opt-ins                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## PART 1 — Get WhatsApp Business API Access (Meta)

### Step 1.1: Create a Meta Developer App

1. Go to **https://developers.facebook.com**
2. Click **My Apps → Create App**
3. Choose **Business** as the app type
4. Enter app name (e.g., "YourCompany Messaging") and your business email
5. Click **Create App**

### Step 1.2: Add the WhatsApp Product

1. In your new app's dashboard, scroll to **"Add Products to Your App"**
2. Find **WhatsApp** and click **Set Up**
3. You'll be taken to **WhatsApp → API Setup**

### Step 1.3: Get Your Credentials (from API Setup page)

You'll see a panel like this — **copy these values into your `.env`**:

| Field                         | Where to find it                                       |
|-------------------------------|--------------------------------------------------------|
| `WHATSAPP_ACCESS_TOKEN`       | "Temporary access token" (valid 24h in dev; use System User token in prod) |
| `WHATSAPP_PHONE_NUMBER_ID`    | Listed under "Phone number ID"                        |
| `WHATSAPP_BUSINESS_ACCOUNT_ID`| Listed under "WhatsApp Business Account ID"           |
| `WHATSAPP_APP_SECRET`         | App Settings → Basic → App Secret                    |

### Step 1.4: Add a Real Phone Number (for Production)

> In dev/test you get a free Meta-provided test number (can message 5 verified test numbers).

1. Go to **WhatsApp → Phone Numbers → Add phone number**
2. Enter a mobile number that will be your WhatsApp Business number
3. Verify it with the OTP Meta sends to that number
4. Wait for Meta review (usually 1–3 business days for standard access)

### Step 1.5: Create a Permanent System User Token (for Production)

The temporary token expires in 24 hours. For production:

1. Go to **Meta Business Suite → Business Settings → Users → System Users**
2. Click **Add → System User** (name: "WhatsApp Bot", role: Admin)
3. Click **Generate New Token** on that system user
4. Select your app → check permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Copy the generated token → this is your permanent `WHATSAPP_ACCESS_TOKEN`

### Step 1.6: Create & Get OTP Template Approved

1. Go to **WhatsApp → Message Templates → Create Template**
2. Category: **Authentication**
3. Template name: `authentication_otp` (or your custom name)
4. Sample body: `Your verification code is {{1}}. It expires in {{2}} minutes.`
5. Submit for review — Meta usually approves Authentication templates within hours

### Step 1.7: Set Up Webhook (after Lambda deployment)

> Come back here after Step 4 (CDK deploy). You'll have the webhook URL.

1. Go to **WhatsApp → Configuration → Webhooks**
2. Click **Edit**
3. Callback URL: `https://YOUR_API_GATEWAY_URL/dev/webhook`
4. Verify Token: the value you set in `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
5. Click **Verify and Save**
6. Under **Webhook fields**, subscribe to:
   - `messages` ✓
   - `message_status_updates` ✓

---

## PART 2 — AWS Setup (First Time Only)

### Step 2.1: Install Prerequisites on Your Machine

```bash
# Node.js 20 (if not installed)
# https://nodejs.org/en/download

# AWS CLI
brew install awscli             # macOS
# or: https://aws.amazon.com/cli

# AWS CDK
npm install -g aws-cdk

# Check versions
node --version       # should be v20+
aws --version
cdk --version
```

### Step 2.2: Configure AWS CLI

```bash
aws configure
# Enter when prompted:
# AWS Access Key ID:     (from AWS Console → IAM → Your User → Security Credentials)
# AWS Secret Access Key: (same place)
# Default region:        ap-south-1    (or your preferred region)
# Default output format: json
```

**How to get AWS credentials:**
1. Log into **AWS Console** → search for **IAM**
2. Go to **Users → Your Username → Security credentials**
3. Click **Create access key** → select **Command Line Interface (CLI)**
4. Download or copy the Access Key ID + Secret Access Key

### Step 2.3: Verify AWS Access

```bash
aws sts get-caller-identity
# Should return your account ID and IAM user ARN
```

---

## PART 3 — Local Development Setup

### Step 3.1: Clone / Set Up the Project

```bash
# Navigate to the project folder
cd whatsapp-service

# Copy environment file
cp .env.example .env
# Edit .env with your values from Part 1
```

### Step 3.2: Install Dependencies

```bash
# Lambda dependencies
cd lambda
npm install

# CDK dependencies
cd ../infrastructure
npm install
cd ..
```

### Step 3.3: Set Up Local PostgreSQL (for local testing)

```bash
# Using Docker (easiest):
docker run -d \
  --name wa-db \
  -e POSTGRES_PASSWORD=localpassword \
  -e POSTGRES_DB=whatsapp_db \
  -p 5432:5432 \
  postgres:15

# Update .env:
DATABASE_URL=postgresql://postgres:localpassword@localhost:5432/whatsapp_db
```

### Step 3.4: Run Database Migrations

```bash
cd lambda
npx prisma migrate dev --name init
npx prisma generate
```

### Step 3.5: Seed the First Admin User (local)

```bash
# Start the local dev server (optional — for testing endpoints locally)
cd lambda
npm run local   # starts on http://localhost:3001

# Then call the seed endpoint:
curl -X POST http://localhost:3001/admin/seed \
  -H "Content-Type: application/json" \
  -H "x-seed-secret: your-seed-secret-from-env" \
  -d '{"name":"Admin User","email":"admin@yourcompany.com","password":"SecurePass123!"}'
```

---

## PART 4 — AWS Deployment

### Step 4.1: Bootstrap CDK (One-Time Per AWS Account/Region)

```bash
cd infrastructure
npx cdk bootstrap
```

This creates an S3 bucket and IAM roles CDK needs. Runs only once per account+region.

### Step 4.2: Build the Lambda

```bash
cd lambda
npm run build
```

This compiles TypeScript → `dist/` folder that CDK will package and upload.

### Step 4.3: Deploy to Dev/Test

```bash
cd infrastructure
npx cdk deploy --context env=dev --require-approval never
```

Wait ~10–15 minutes (RDS creation takes time). At the end you'll see **Outputs**:

```
WhatsAppServiceDev.ApiUrl = https://xxxxxx.execute-api.ap-south-1.amazonaws.com/dev/
WhatsAppServiceDev.AdminUiUrl = https://xxxxxxxxxx.cloudfront.net
WhatsAppServiceDev.WhatsAppWebhookUrl = https://xxxxxx.execute-api.../dev/webhook
WhatsAppServiceDev.WhatsAppSecretArn = arn:aws:secretsmanager:...
```

**Save these — you'll need them.**

### Step 4.4: Update WhatsApp Credentials in Secrets Manager

```bash
# Option A: AWS Console (easiest for first time)
# 1. Go to AWS Console → Secrets Manager
# 2. Find the secret named "whatsapp-dev/whatsapp-config"
# 3. Click "Retrieve secret value" → Edit
# 4. Replace all "REPLACE_AFTER_DEPLOY" values with your real credentials

# Option B: AWS CLI
aws secretsmanager put-secret-value \
  --secret-id "whatsapp-dev/whatsapp-config" \
  --secret-string '{
    "WHATSAPP_ACCESS_TOKEN":         "EAAxxxxxxx",
    "WHATSAPP_PHONE_NUMBER_ID":      "1234567890",
    "WHATSAPP_BUSINESS_ACCOUNT_ID":  "9876543210",
    "WHATSAPP_APP_SECRET":           "abcdef...",
    "WHATSAPP_WEBHOOK_VERIFY_TOKEN": "my-verify-token",
    "JWT_SECRET":                    "a-long-random-secret",
    "INTERNAL_API_KEY":              "your-app-api-key",
    "ADMIN_SEED_SECRET":             "one-time-secret"
  }'
```

### Step 4.5: Update Lambda Environment Variables

After setting the secret, update Lambda env vars to use the real values:

```bash
aws lambda update-function-configuration \
  --function-name whatsapp-dev-handler \
  --environment Variables="{
    NODE_ENV=development,
    DATABASE_URL=postgresql://postgres:DBPASS@RDS_ENDPOINT:5432/whatsapp_db,
    WHATSAPP_ACCESS_TOKEN=EAAxxxxxxx,
    WHATSAPP_PHONE_NUMBER_ID=1234567890,
    WHATSAPP_BUSINESS_ACCOUNT_ID=9876543210,
    WHATSAPP_APP_SECRET=abcdef...,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN=my-verify-token,
    JWT_SECRET=your-jwt-secret,
    INTERNAL_API_KEY=your-api-key,
    ADMIN_SEED_SECRET=one-time-secret,
    OTP_EXPIRY_MINUTES=10,
    OTP_MAX_ATTEMPTS=3
  }"
```

> **Get DATABASE_URL**: `RDS_ENDPOINT` = the `DbEndpoint` from CDK outputs. `DBPASS` = the password from `whatsapp-dev/db-password` secret in Secrets Manager.

### Step 4.6: Run Database Migrations on RDS

Since RDS is in a private VPC, the easiest way to run migrations is via Lambda:

```bash
# Invoke the Lambda directly to run migrations
aws lambda invoke \
  --function-name whatsapp-dev-handler \
  --payload '{"path":"/migrate","httpMethod":"POST","headers":{"x-seed-secret":"one-time-secret"},"body":"{}"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/response.json

# Alternative: Use AWS RDS Query Editor in the console
# Or: Set up Session Manager SSM port-forwarding (see scripts/run-migration.sh)
```

**Simpler approach — add a migration handler to your Lambda:**

In `src/index.ts`, the router handles `/migrate` if you expose it temporarily (remove after first deploy).

### Step 4.7: Create the First Admin User

```bash
curl -X POST https://YOUR_API_GATEWAY_URL/dev/admin/seed \
  -H "Content-Type: application/json" \
  -H "x-seed-secret: one-time-secret" \
  -d '{"name":"Admin","email":"admin@yourcompany.com","password":"SecurePass123!"}'
```

### Step 4.8: Update Admin UI API URL

Edit `admin-ui/app.js`, line 2:
```js
const API_BASE = 'https://YOUR_API_GATEWAY_URL/dev';
```

Then redeploy just the UI (faster):
```bash
# Upload admin-ui to S3 manually
aws s3 sync admin-ui/ s3://whatsapp-dev-admin-ui/ --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/*"
```

### Step 4.9: Register Webhook URL with Meta

Go back to **Part 1, Step 1.7** and register:
- **Callback URL**: `https://YOUR_API_GATEWAY_URL/dev/webhook`
- **Verify Token**: your `WHATSAPP_WEBHOOK_VERIFY_TOKEN`

---

## PART 5 — Integrating with Your Existing Application

### Sending OTP (from your Node.js / any backend)

```typescript
// Install axios: npm install axios

import axios from 'axios';

const WA_SERVICE_URL  = 'https://YOUR_API_GATEWAY_URL/dev';
const INTERNAL_API_KEY = process.env.WA_INTERNAL_API_KEY; // keep this secret

// 1. Send OTP
async function sendWhatsAppOtp(phone: string, userId: string) {
  const res = await axios.post(`${WA_SERVICE_URL}/otp/send`, {
    phone,          // E.164 format: +91XXXXXXXXXX
    customerId: userId,
  }, {
    headers: { 'x-api-key': INTERNAL_API_KEY }
  });
  return res.data.data; // { otpLogId, expiresAt }
}

// 2. Verify OTP
async function verifyWhatsAppOtp(phone: string, otp: string) {
  const res = await axios.post(`${WA_SERVICE_URL}/otp/verify`, {
    phone,
    otp,
  }, {
    headers: { 'x-api-key': INTERNAL_API_KEY }
  });
  return res.data.data.verified; // true / false
}

// Usage in your auth flow:
app.post('/auth/request-otp', async (req, res) => {
  const { phone } = req.body;
  await sendWhatsAppOtp(phone, req.user.id);
  res.json({ message: 'OTP sent to your WhatsApp' });
});

app.post('/auth/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  const verified = await verifyWhatsAppOtp(phone, otp);
  if (verified) {
    // proceed with login / 2FA completion
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid OTP' });
  }
});
```

### Importing Existing Customers

```bash
curl -X POST https://YOUR_API_GATEWAY_URL/dev/customers/import \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customers": [
      {"name":"Alice","phone":"+919876543210","email":"alice@example.com"},
      {"name":"Bob","phone":"+917890123456","email":"bob@example.com"}
    ]
  }'
```

---

## PART 6 — Complete API Reference

### Public (Webhook)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/webhook` | Meta verification handshake |
| POST | `/webhook` | Receive messages & status updates |

### System (x-api-key header)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/otp/send` | Send OTP via WhatsApp |
| POST | `/otp/verify` | Verify OTP entered by user |

### Admin (Bearer JWT)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/login` | Admin login → JWT |
| POST | `/admin/seed` | Create first admin (one-time) |
| GET | `/admin/me` | Current admin profile |
| GET | `/admin/stats` | Dashboard statistics |
| GET | `/customers` | List customers |
| POST | `/customers` | Add customer |
| POST | `/customers/import` | Bulk import |
| PUT | `/customers/{id}` | Update customer |
| POST | `/messages/send` | Send individual message |
| POST | `/messages/broadcast` | Send campaign |
| GET | `/messages` | Message log (filterable) |
| GET | `/templates` | WhatsApp approved templates |

---

## PART 7 — Prod Deployment (When Ready)

```bash
cd infrastructure
npx cdk deploy --context env=prod
```

Differences from dev:
- RDS: `db.t3.small` + Multi-AZ + 7-day backups (retained on destroy)
- Lambda: 1GB RAM
- NAT Gateway: 1 (for Lambda → internet access in private subnet)
- CloudWatch retention: 30 days

---

## PART 8 — Troubleshooting

### Lambda can't connect to RDS
- Ensure Lambda's security group (`lambdaSg`) is allowed to connect on port 5432 in RDS's security group
- Lambda must be in a subnet with NAT Gateway (to reach Meta's API)

### WhatsApp webhook verification fails
- Check `WHATSAPP_WEBHOOK_VERIFY_TOKEN` matches exactly in both Lambda env and Meta portal
- Test: `curl "https://YOUR_API_URL/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test"` — should return `test`

### Messages send but status never updates
- Webhook subscriptions: ensure `messages` and `message_status_updates` are checked in Meta portal

### "Template not found" error
- Verify the template name is exactly as it appears in Meta (case-sensitive)
- Template must be in **APPROVED** status (not PENDING)

### Free Tier limits (AWS)
- RDS Free Tier: 750 hours/month of `db.t3.micro` — **keep only one instance running**
- Lambda: 1M requests/month free — plenty for dev/test
- CloudFront: 1TB/month free
- API Gateway: 1M REST API calls/month free for first 12 months

---

## Project Structure

```
whatsapp-service/
├── lambda/
│   └── src/
│       ├── index.ts              ← Main router (Lambda entry point)
│       ├── handlers/
│       │   ├── webhook.ts        ← WhatsApp webhook (verify + receive)
│       │   ├── otp.ts            ← OTP send + verify
│       │   ├── messages.ts       ← Send individual + broadcast
│       │   ├── customers.ts      ← Customer CRUD + import
│       │   └── admin.ts          ← Admin auth + dashboard stats
│       ├── services/
│       │   ├── whatsapp.service.ts ← Meta Cloud API client
│       │   └── otp.service.ts    ← OTP generation + verification
│       ├── db/
│       │   ├── prisma.ts         ← Prisma client singleton
│       │   └── schema.prisma     ← PostgreSQL schema
│       ├── middleware/
│       │   └── auth.ts           ← JWT + API key authentication
│       └── utils/
│           └── response.ts       ← HTTP response helpers
├── infrastructure/
│   ├── bin/app.ts                ← CDK app entry (dev + prod stacks)
│   └── lib/whatsapp-stack.ts     ← Full AWS CDK stack
├── admin-ui/
│   ├── index.html                ← Admin dashboard HTML
│   └── app.js                    ← Dashboard JavaScript
├── scripts/
│   ├── build-and-deploy.sh       ← Full build + deploy script
│   └── run-migration.sh          ← Run DB migrations via Lambda
├── .env.example                  ← Environment template
└── README.md                     ← This file
```
