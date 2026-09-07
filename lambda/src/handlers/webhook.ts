/**
 * WhatsApp Webhook Handler
 *
 * Two modes:
 * 1. GET  - Meta verification handshake (one-time setup)
 * 2. POST - Incoming messages & status updates from Meta
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../db/prisma';
import { WhatsAppService } from '../services/whatsapp.service';
import { ok, error } from '../utils/response';

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'my-verify-token';
const APP_SECRET   = process.env.WHATSAPP_APP_SECRET || '';

// ─── GET: Webhook verification (called once by Meta when you set up the webhook)
export async function verifyWebhook(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const params = event.queryStringParameters || {};
  const mode      = params['hub.mode'];
  const token     = params['hub.verify_token'];
  const challenge = params['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[Webhook] Verification successful');
    return { statusCode: 200, body: challenge || '', headers: { 'Content-Type': 'text/plain' } };
  }

  console.warn('[Webhook] Verification failed. Token mismatch.');
  return error('Verification failed', 403);
}

// ─── POST: Incoming webhook payload from Meta ─────────────────────────────────
export async function handleWebhook(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Verify signature (security — don't skip in production)
  if (APP_SECRET && event.body) {
    const signature = event.headers?.['x-hub-signature-256'] || '';
    const isValid = WhatsAppService.verifyWebhookSignature(event.body, signature, APP_SECRET);
    if (!isValid) {
      console.warn('[Webhook] Invalid signature');
      return error('Invalid signature', 401);
    }
  }

  const body = JSON.parse(event.body || '{}');

  // 2. Store raw event for audit / replay
  await prisma.webhookEvent.create({
    data: {
      id: uuidv4(),
      eventType: body.entry?.[0]?.changes?.[0]?.field || 'unknown',
      payload: body,
    },
  });

  // 3. Process changes
  const entries = body.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      const value = change.value;

      // ─ Incoming messages ──────────────────────────────────────────────────
      const messages = value?.messages || [];
      for (const msg of messages) {
        await handleIncomingMessage(msg, value?.contacts?.[0]);
      }

      // ─ Status updates (sent, delivered, read, failed) ────────────────────
      const statuses = value?.statuses || [];
      for (const status of statuses) {
        await handleStatusUpdate(status);
      }
    }
  }

  // 4. WhatsApp requires a 200 response within 20 seconds
  return ok({ received: true });
}

// ─── Handle incoming message from a customer ──────────────────────────────────
async function handleIncomingMessage(msg: any, contact: any): Promise<void> {
  const phone = '+' + (msg.from || '').replace(/^\+/, '');
  const msgType = msg.type; // text, image, audio, etc.
  const text    = msg.text?.body;

  console.log(`[Webhook] Incoming ${msgType} from ${phone}: ${text}`);

  // Auto-handle opt-out keywords
  if (msgType === 'text' && text) {
    const lower = text.trim().toLowerCase();
    if (['stop', 'unsubscribe', 'optout', 'opt out', 'quit'].includes(lower)) {
      await prisma.customer.updateMany({
        where: { phone },
        data: { isOptedIn: false, optedOutAt: new Date() },
      });
      console.log(`[Webhook] Customer ${phone} opted out`);
      return;
    }
    if (['start', 'subscribe', 'optin', 'opt in', 'join'].includes(lower)) {
      await prisma.customer.updateMany({
        where: { phone },
        data: { isOptedIn: true, optedInAt: new Date(), optedOutAt: null },
      });
      console.log(`[Webhook] Customer ${phone} opted in`);
      return;
    }
  }

  // Mark as read (optional — shows blue ticks to sender)
  // const waService = new WhatsAppService();
  // await waService.markAsRead(msg.id);
}

// ─── Handle delivery / read status updates ────────────────────────────────────
async function handleStatusUpdate(status: any): Promise<void> {
  const waMessageId = status.id;
  const statusValue = status.status; // sent | delivered | read | failed

  const statusMap: Record<string, string> = {
    sent: 'SENT',
    delivered: 'DELIVERED',
    read: 'READ',
    failed: 'FAILED',
  };

  const newStatus = statusMap[statusValue];
  if (!newStatus || !waMessageId) return;

  await prisma.message.updateMany({
    where: { waMessageId },
    data: {
      status: newStatus as any,
      ...(newStatus === 'SENT'      ? { sentAt:      new Date() } : {}),
      ...(newStatus === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
      ...(newStatus === 'READ'      ? { readAt:      new Date() } : {}),
      ...(newStatus === 'FAILED'    ? {
        failedAt:   new Date(),
        failReason: status.errors?.[0]?.title || 'Unknown error',
      } : {}),
    },
  });

  // Mark webhook event processed
  await prisma.webhookEvent.updateMany({
    where: { waMessageId },
    data: { processed: true, processedAt: new Date() },
  });
}
