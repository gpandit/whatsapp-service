/**
 * WhatsApp Lambda Handler — Main Router
 *
 * All API Gateway requests hit this single Lambda function.
 * Routes are matched by path + method and dispatched to the appropriate handler.
 *
 * API Routes:
 *   GET  /webhook              → WhatsApp verification handshake
 *   POST /webhook              → Incoming WhatsApp messages & status updates
 *
 *   POST /otp/send             → Send OTP (system API key required)
 *   POST /otp/verify           → Verify OTP (system API key required)
 *
 *   POST /admin/login          → Admin login
 *   POST /admin/seed           → Create first admin (one-time)
 *   GET  /admin/me             → Current admin profile
 *   GET  /admin/stats          → Dashboard statistics
 *
 *   GET  /customers            → List customers
 *   POST /customers            → Add customer
 *   POST /customers/import     → Bulk import customers
 *   PUT  /customers/{id}       → Update customer
 *
 *   POST /messages/send        → Send individual message (admin)
 *   POST /messages/broadcast   → Send campaign (admin)
 *   GET  /messages             → List messages
 *   GET  /templates            → List approved WhatsApp templates
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { verifyWebhook, handleWebhook } from './handlers/webhook';
import { sendOtp, verifyOtp } from './handlers/otp';
import { login, seedAdmin, getMe, getDashboardStats } from './handlers/admin';
import { listCustomers, createCustomer, importCustomers, updateCustomer } from './handlers/customers';
import { sendMessage, broadcastMessage, listMessages, listTemplates } from './handlers/messages';
import { corsPreFlight } from './utils/response';

// ─── Route Table ──────────────────────────────────────────────────────────────
type Handler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

interface Route {
  method: string;
  pathPattern: RegExp;
  handler: Handler;
}

const routes: Route[] = [
  // Webhook
  { method: 'GET',     pathPattern: /^\/webhook$/,              handler: verifyWebhook },
  { method: 'POST',    pathPattern: /^\/webhook$/,              handler: handleWebhook },

  // OTP (system-to-system)
  { method: 'POST',    pathPattern: /^\/otp\/send$/,            handler: sendOtp },
  { method: 'POST',    pathPattern: /^\/otp\/verify$/,          handler: verifyOtp },

  // Admin auth
  { method: 'POST',    pathPattern: /^\/admin\/login$/,         handler: login },
  { method: 'POST',    pathPattern: /^\/admin\/seed$/,          handler: seedAdmin },
  { method: 'GET',     pathPattern: /^\/admin\/me$/,            handler: getMe },
  { method: 'GET',     pathPattern: /^\/admin\/stats$/,         handler: getDashboardStats },

  // Customers
  { method: 'GET',     pathPattern: /^\/customers$/,            handler: listCustomers },
  { method: 'POST',    pathPattern: /^\/customers$/,            handler: createCustomer },
  { method: 'POST',    pathPattern: /^\/customers\/import$/,    handler: importCustomers },
  { method: 'PUT',     pathPattern: /^\/customers\/([^/]+)$/,  handler: updateCustomer },

  // Messages
  { method: 'POST',    pathPattern: /^\/messages\/send$/,       handler: sendMessage },
  { method: 'POST',    pathPattern: /^\/messages\/broadcast$/,  handler: broadcastMessage },
  { method: 'GET',     pathPattern: /^\/messages$/,             handler: listMessages },
  { method: 'GET',     pathPattern: /^\/templates$/,            handler: listTemplates },
];

// ─── Lambda Handler ───────────────────────────────────────────────────────────
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const path   = event.path || '/';
  const method = event.httpMethod?.toUpperCase() || 'GET';

  console.log(`[Router] ${method} ${path}`);

  // Handle CORS pre-flight for all routes
  if (method === 'OPTIONS') return corsPreFlight();

  // Match route
  for (const route of routes) {
    if (route.method === method && route.pathPattern.test(path)) {
      try {
        return await route.handler(event);
      } catch (err) {
        console.error(`[Router] Unhandled error in ${method} ${path}:`, err);
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Internal server error' }),
        };
      }
    }
  }

  // No matching route
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: false, error: `Route not found: ${method} ${path}` }),
  };
};
