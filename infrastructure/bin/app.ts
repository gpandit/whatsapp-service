#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WhatsAppStack } from '../lib/whatsapp-stack';

const app = new cdk.App();

const env = app.node.tryGetContext('env') || 'dev';

// ── Dev / Test Stack ──────────────────────────────────────────────────────────
if (env === 'dev') {
  new WhatsAppStack(app, 'WhatsAppServiceDev', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region:  process.env.CDK_DEFAULT_REGION || 'ap-south-1',
    },
    stageName: 'dev',
    // RDS: use t3.micro (Free Tier eligible)
    dbInstanceClass: 'db.t3.micro',
    // Lambda memory
    lambdaMemoryMb: 512,
    // Keep single AZ for dev (cheaper)
    multiAz: false,
    tags: { Environment: 'dev', Project: 'WhatsAppService' },
  });
}

// ── Production Stack ──────────────────────────────────────────────────────────
if (env === 'prod') {
  new WhatsAppStack(app, 'WhatsAppServiceProd', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region:  process.env.CDK_DEFAULT_REGION || 'ap-south-1',
    },
    stageName: 'prod',
    dbInstanceClass: 'db.t3.small',
    lambdaMemoryMb: 1024,
    multiAz: true,
    tags: { Environment: 'prod', Project: 'WhatsAppService' },
  });
}

app.synth();
