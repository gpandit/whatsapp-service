/**
 * Message Handlers (Admin & System)
 *
 * POST /messages/send           - Send individual message (admin)
 * POST /messages/broadcast      - Send campaign to multiple customers (admin)
 * GET  /messages                - List messages with filters (admin)
 * GET  /messages/:id            - Get single message detail (admin)
 * GET  /templates               - List approved WhatsApp templates (admin)
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../db/prisma';
import { WhatsAppService } from '../services/whatsapp.service';
import { verifyAdminToken } from '../middleware/auth';
import {
  ok, created, error, unauthorized, serverError, corsPreFlight, notFound
} from '../utils/response';

const waService = new WhatsAppService();

// ─── POST /messages/send ──────────────────────────────────────────────────────
// Send a message to a single customer
export async function sendMessage(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();

  const admin = verifyAdminToken(event);
  if (!admin) return unauthorized();

  let body: {
    customerId?: string;
    phone?: string;
    type: 'TRANSACTIONAL' | 'MARKETING';
    templateName: string;
    language?: string;
    components?: any[];
    freeText?: string;
  };

  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return error('Invalid JSON body');
  }

  const { customerId, phone, type, templateName, language, components, freeText } = body;

  if (!templateName && !freeText) return error('templateName or freeText is required');
  if (!customerId && !phone) return error('customerId or phone is required');

  // Resolve customer
  let customer;
  if (customerId) {
    customer = await prisma.customer.findUnique({ where: { id: customerId } });
  } else if (phone) {
    customer = await prisma.customer.findUnique({ where: { phone } });
  }

  if (!customer) return notFound('Customer not found');
  if (!customer.isOptedIn) return error('Customer has opted out of WhatsApp messages', 403);

  try {
    let waResponse;
    let sentFreeText: string | undefined;

    if (templateName) {
      waResponse = await waService.sendTemplate({
        to: customer.phone,
        templateName,
        language,
        components,
      });
    } else if (freeText) {
      waResponse = await waService.sendText({ to: customer.phone, message: freeText });
      sentFreeText = freeText;
    }

    const messageId = uuidv4();
    const message = await prisma.message.create({
      data: {
        id: messageId,
        customerId: customer.id,
        type: type || 'TRANSACTIONAL',
        status: 'SENT',
        waMessageId: waResponse?.messages[0]?.id,
        templateName,
        templateParams: components ? { components } : undefined,
        freeText: sentFreeText,
        sentAt: new Date(),
        sentBy: admin.adminId,
      },
    });

    return created({ messageId: message.id, waMessageId: waResponse?.messages[0]?.id });
  } catch (err) {
    return serverError(err);
  }
}

// ─── POST /messages/broadcast ─────────────────────────────────────────────────
// Bulk send marketing campaign to multiple customers
export async function broadcastMessage(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();

  const admin = verifyAdminToken(event);
  if (!admin) return unauthorized();

  let body: {
    campaignName: string;
    description?: string;
    templateName: string;
    language?: string;
    components?: any[];
    customerIds?: string[];   // specific customers, OR
    sendToAll?: boolean;      // all opted-in customers
  };

  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return error('Invalid JSON body');
  }

  const { campaignName, description, templateName, language, components, customerIds, sendToAll } = body;

  if (!templateName) return error('templateName is required');
  if (!campaignName) return error('campaignName is required');
  if (!customerIds?.length && !sendToAll) return error('Provide customerIds or set sendToAll: true');

  // Fetch target customers (only opted-in)
  const whereClause = sendToAll
    ? { isOptedIn: true }
    : { id: { in: customerIds }, isOptedIn: true };

  const customers = await prisma.customer.findMany({ where: whereClause, select: { id: true, phone: true } });

  if (!customers.length) return error('No opted-in customers found');

  // Create campaign record
  const campaign = await prisma.campaign.create({
    data: {
      id: uuidv4(),
      name: campaignName,
      description,
      templateName,
      templateParams: components ? { components } : undefined,
      status: 'SENDING',
      recipientCount: customers.length,
      createdBy: admin.adminId,
      sentAt: new Date(),
    },
  });

  // Send messages (with rate limiting — Meta allows 1000 msgs/minute on cloud API)
  let successCount = 0;
  let failCount = 0;
  const BATCH_DELAY_MS = 100; // 10 messages/sec to stay safe

  for (const customer of customers) {
    try {
      const waResponse = await waService.sendTemplate({
        to: customer.phone,
        templateName,
        language,
        components,
      });

      await prisma.message.create({
        data: {
          id: uuidv4(),
          customerId: customer.id,
          type: 'MARKETING',
          status: 'SENT',
          waMessageId: waResponse.messages[0]?.id,
          templateName,
          templateParams: components ? { components } : undefined,
          sentAt: new Date(),
          sentBy: admin.adminId,
          campaignId: campaign.id,
        },
      });
      successCount++;
    } catch (err) {
      failCount++;
      console.error(`[Broadcast] Failed for ${customer.phone}:`, err);
      await prisma.message.create({
        data: {
          id: uuidv4(),
          customerId: customer.id,
          type: 'MARKETING',
          status: 'FAILED',
          templateName,
          campaignId: campaign.id,
          sentBy: admin.adminId,
          failedAt: new Date(),
          failReason: err instanceof Error ? err.message : 'Send failed',
        },
      });
    }

    // Respect rate limit
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  // Update campaign with results
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: 'COMPLETED', successCount, failCount },
  });

  return ok({
    campaignId: campaign.id,
    sent: successCount,
    failed: failCount,
    total: customers.length,
  });
}

// ─── GET /messages ────────────────────────────────────────────────────────────
export async function listMessages(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();

  const admin = verifyAdminToken(event);
  if (!admin) return unauthorized();

  const params = event.queryStringParameters || {};
  const page   = parseInt(params.page || '1');
  const limit  = Math.min(parseInt(params.limit || '20'), 100);
  const skip   = (page - 1) * limit;
  const type   = params.type;
  const status = params.status;

  const where: any = {};
  if (type)   where.type   = type;
  if (status) where.status = status;

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.message.count({ where }),
  ]);

  return ok({ messages, total, page, limit, pages: Math.ceil(total / limit) });
}

// ─── GET /templates ───────────────────────────────────────────────────────────
export async function listTemplates(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();

  const admin = verifyAdminToken(event);
  if (!admin) return unauthorized();

  try {
    // Fetch fresh from Meta and cache in DB
    const templates = await waService.getTemplates();

    // Sync to local DB for offline reference
    for (const t of templates) {
      await prisma.wATemplate.upsert({
        where: { name: t.name },
        update: {
          status: t.status,
          components: t.components,
          syncedAt: new Date(),
        },
        create: {
          id: uuidv4(),
          name: t.name,
          language: t.language || 'en_US',
          category: t.category || 'UTILITY',
          components: t.components,
          status: t.status,
        },
      });
    }

    return ok({ templates });
  } catch (err) {
    // If Meta API fails, fall back to DB cache
    const cached = await prisma.wATemplate.findMany();
    return ok({ templates: cached, cached: true });
  }
}
