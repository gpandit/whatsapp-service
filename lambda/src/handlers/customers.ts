/**
 * Customer Management Handlers
 *
 * GET    /customers         - List customers
 * POST   /customers         - Add a customer
 * POST   /customers/import  - Bulk import customers
 * PUT    /customers/:id     - Update customer
 * DELETE /customers/:id     - Remove customer (GDPR)
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../db/prisma';
import { verifyAdminToken } from '../middleware/auth';
import { ok, created, error, unauthorized, serverError, corsPreFlight, notFound } from '../utils/response';

// ─── GET /customers ───────────────────────────────────────────────────────────
export async function listCustomers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();
  const admin = verifyAdminToken(event);
  if (!admin) return unauthorized();

  const params = event.queryStringParameters || {};
  const page  = parseInt(params.page  || '1');
  const limit = Math.min(parseInt(params.limit || '20'), 100);
  const skip  = (page - 1) * limit;
  const search = params.search;

  const where: any = {};
  if (search) {
    where.OR = [
      { name:  { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  return ok({ customers, total, page, limit, pages: Math.ceil(total / limit) });
}

// ─── POST /customers ──────────────────────────────────────────────────────────
export async function createCustomer(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();
  const admin = verifyAdminToken(event);
  if (!admin) return unauthorized();

  let body: { name: string; phone: string; email?: string; metadata?: any };
  try { body = JSON.parse(event.body || '{}'); }
  catch { return error('Invalid JSON body'); }

  const { name, phone, email, metadata } = body;
  if (!name || !phone) return error('name and phone are required');

  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  if (!phoneRegex.test(phone)) return error('Invalid phone format. Use E.164: +1234567890');

  try {
    const customer = await prisma.customer.create({
      data: {
        id: uuidv4(),
        name,
        phone,
        email,
        metadata,
        isOptedIn: true,
        optedInAt: new Date(),
      },
    });
    return created(customer);
  } catch (err: any) {
    if (err.code === 'P2002') return error('A customer with that phone or email already exists', 409);
    return serverError(err);
  }
}

// ─── POST /customers/import ───────────────────────────────────────────────────
// Bulk import from your existing database / CSV
export async function importCustomers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();
  const admin = verifyAdminToken(event);
  if (!admin) return unauthorized();

  let body: { customers: Array<{ name: string; phone: string; email?: string; metadata?: any }> };
  try { body = JSON.parse(event.body || '{}'); }
  catch { return error('Invalid JSON body'); }

  if (!body.customers?.length) return error('customers array is required');

  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  let imported = 0, skipped = 0;

  for (const c of body.customers) {
    if (!c.phone || !phoneRegex.test(c.phone)) { skipped++; continue; }
    try {
      await prisma.customer.upsert({
        where: { phone: c.phone },
        update: { name: c.name, email: c.email, metadata: c.metadata },
        create: {
          id: uuidv4(),
          name: c.name || 'Imported',
          phone: c.phone,
          email: c.email,
          metadata: c.metadata,
          isOptedIn: true,
          optedInAt: new Date(),
        },
      });
      imported++;
    } catch { skipped++; }
  }

  return ok({ imported, skipped, total: body.customers.length });
}

// ─── PUT /customers/{id} ──────────────────────────────────────────────────────
export async function updateCustomer(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();
  const admin = verifyAdminToken(event);
  if (!admin) return unauthorized();

  const id = event.pathParameters?.id;
  if (!id) return error('Customer ID is required');

  let body: any;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return error('Invalid JSON body'); }

  try {
    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name: body.name,
        email: body.email,
        metadata: body.metadata,
        isOptedIn: body.isOptedIn,
        ...(body.isOptedIn === false ? { optedOutAt: new Date() } : {}),
        ...(body.isOptedIn === true  ? { optedInAt: new Date(), optedOutAt: null } : {}),
      },
    });
    return ok(customer);
  } catch (err: any) {
    if (err.code === 'P2025') return notFound('Customer not found');
    return serverError(err);
  }
}
