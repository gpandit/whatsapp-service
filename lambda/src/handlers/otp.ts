/**
 * OTP Handler
 * Called by your application's backend (system-to-system)
 * Protected by INTERNAL_API_KEY header
 *
 * POST /otp/send   - Send OTP to a phone number
 * POST /otp/verify - Verify OTP entered by user
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { otpService } from '../services/otp.service';
import { verifyApiKey } from '../middleware/auth';
import { ok, error, unauthorized, serverError, corsPreFlight } from '../utils/response';

// ─── POST /otp/send ───────────────────────────────────────────────────────────
export async function sendOtp(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();

  // Auth: only your application backend can call this
  if (!verifyApiKey(event)) return unauthorized('Invalid or missing API key');

  let body: { phone: string; customerId?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return error('Invalid JSON body');
  }

  const { phone, customerId } = body;

  if (!phone) return error('phone is required (E.164 format: +1234567890)');

  // Validate E.164 format
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  if (!phoneRegex.test(phone)) {
    return error('Invalid phone format. Use E.164 format: +1234567890');
  }

  try {
    const result = await otpService.sendOtp(phone, customerId);
    return ok({
      otpLogId: result.otpLogId,
      expiresAt: result.expiresAt,
      message: 'OTP sent successfully via WhatsApp',
    });
  } catch (err) {
    return serverError(err);
  }
}

// ─── POST /otp/verify ─────────────────────────────────────────────────────────
export async function verifyOtp(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') return corsPreFlight();

  if (!verifyApiKey(event)) return unauthorized('Invalid or missing API key');

  let body: { phone: string; otp: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return error('Invalid JSON body');
  }

  const { phone, otp } = body;
  if (!phone || !otp) return error('phone and otp are required');

  try {
    const result = await otpService.verifyOtp(phone, otp);
    if (result.success) {
      return ok({ verified: true, message: result.message });
    } else {
      return error(result.message, 400);
    }
  } catch (err) {
    return serverError(err);
  }
}
