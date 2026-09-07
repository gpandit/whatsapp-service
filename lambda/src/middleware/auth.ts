import jwt from 'jsonwebtoken';
import { APIGatewayProxyEvent } from 'aws-lambda';
import prisma from '../db/prisma';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

export interface AdminTokenPayload {
  adminId: string;
  email: string;
  role: string;
}

// ─── Generate JWT for admin ───────────────────────────────────────────────────
export function generateAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

// ─── Verify JWT from Authorization header ─────────────────────────────────────
export function verifyAdminToken(event: APIGatewayProxyEvent): AdminTokenPayload | null {
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];
  try {
    return jwt.verify(token, JWT_SECRET) as AdminTokenPayload;
  } catch {
    return null;
  }
}

// ─── Admin Login ──────────────────────────────────────────────────────────────
export async function adminLogin(
  email: string,
  password: string
): Promise<{ token: string; admin: { id: string; name: string; email: string; role: string } } | null> {
  const admin = await prisma.adminUser.findUnique({
    where: { email, isActive: true },
  });

  if (!admin) return null;

  const isValid = await bcrypt.compare(password, admin.passwordHash);
  if (!isValid) return null;

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  const token = generateAdminToken({
    adminId: admin.id,
    email: admin.email,
    role: admin.role,
  });

  return {
    token,
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  };
}

// ─── Internal API Key auth (for system-to-system calls, e.g. OTP from your app) ─
export function verifyApiKey(event: APIGatewayProxyEvent): boolean {
  const apiKey = event.headers?.['x-api-key'] || event.headers?.['X-Api-Key'];
  return apiKey === process.env.INTERNAL_API_KEY;
}
