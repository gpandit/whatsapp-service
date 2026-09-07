/**
 * Admin Auth Handler
 *
 * POST /admin/login    - Admin login → JWT token
 * POST /admin/seed     - Create first admin user (run once)
 * GET  /admin/me       - Get current admin profile
 * GET  /admin/stats    - Dashboard statistics
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import prisma from '../db/prisma';
import { adminLogin, verifyAdminToken } from '../middleware/auth';
import { ok, created, error, unauthorized, serverError, corsPreFlight } from '../utils/response';

// ─── POST /admin/login ────────────────────────────────────────────────────────
export async function login(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();

  let body: { email: string; password: string };
  try { body = JSON.parse(event.body || '{}'); }
  catch { return error('Invalid JSON body'); }

  const { email, password } = body;
  if (!email || !password) return error('email and password are required');

  try {
    const result = await adminLogin(email, password);
    if (!result) return unauthorized('Invalid credentials');
    return ok(result);
  } catch (err) {
    return serverError(err);
  }
}

// ─── POST /admin/seed ─────────────────────────────────────────────────────────
// One-time setup: creates the first SUPER_ADMIN user
// Protect with SEED_SECRET env var
export async function seedAdmin(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();

  const seedSecret = event.headers?.['x-seed-secret'];
  if (seedSecret !== process.env.ADMIN_SEED_SECRET) {
    return unauthorized('Invalid seed secret');
  }

  let body: { name: string; email: string; password: string };
  try { body = JSON.parse(event.body || '{}'); }
  catch { return error('Invalid JSON body'); }

  const { name, email, password } = body;
  if (!name || !email || !password) return error('name, email, password required');

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) return error('Admin user already exists', 409);

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.adminUser.create({
    data: {
      id: uuidv4(),
      name,
      email,
      passwordHash,
      role: 'SUPER_ADMIN',
    },
  });

  return created({ id: admin.id, email: admin.email, role: admin.role });
}

// ─── GET /admin/me ────────────────────────────────────────────────────────────
export async function getMe(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();

  const admin = verifyAdminToken(event);
  if (!admin) return unauthorized();

  const adminUser = await prisma.adminUser.findUnique({
    where: { id: admin.adminId },
    select: { id: true, name: true, email: true, role: true, lastLoginAt: true },
  });

  return ok(adminUser);
}

// ─── GET /admin/stats ─────────────────────────────────────────────────────────
export async function getDashboardStats(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();

  const admin = verifyAdminToken(event);
  if (!admin) return unauthorized();

  const [
    totalCustomers,
    optedInCustomers,
    totalMessages,
    sentToday,
    deliveredToday,
    failedToday,
    recentMessages,
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.customer.count({ where: { isOptedIn: true } }),
    prisma.message.count(),
    prisma.message.count({
      where: { sentAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    }),
    prisma.message.count({
      where: {
        status: 'DELIVERED',
        deliveredAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
    prisma.message.count({
      where: {
        status: 'FAILED',
        failedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
    prisma.message.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true, phone: true } } },
    }),
  ]);

  return ok({
    customers: { total: totalCustomers, optedIn: optedInCustomers },
    messages: { total: totalMessages, sentToday, deliveredToday, failedToday },
    recentMessages,
  });
}
