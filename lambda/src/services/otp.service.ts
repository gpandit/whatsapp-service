import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../db/prisma';
import { WhatsAppService } from './whatsapp.service';

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 10;
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS) || 3;

export interface OtpSendResult {
  success: boolean;
  otpLogId: string;
  expiresAt: Date;
  waMessageId?: string;
}

export interface OtpVerifyResult {
  success: boolean;
  message: string;
}

export class OtpService {
  private waService: WhatsAppService;

  constructor() {
    this.waService = new WhatsAppService();
  }

  // ─── Generate a 6-digit OTP ───────────────────────────────────────────────
  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // ─── Send OTP to a phone number ───────────────────────────────────────────
  async sendOtp(phone: string, customerId?: string): Promise<OtpSendResult> {
    // 1. Generate OTP
    const otp = this.generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // 2. Hash OTP before storing (never store plain OTPs)
    const hashedOtp = await bcrypt.hash(otp, 10);

    // 3. If no customerId passed, look up or create customer
    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId) {
      let customer = await prisma.customer.findUnique({ where: { phone } });
      if (!customer) {
        customer = await prisma.customer.create({
          data: { phone, name: 'Unknown', isOptedIn: true },
        });
      }
      resolvedCustomerId = customer.id;
    }

    // 4. Expire any existing active OTPs for this phone
    await prisma.otpLog.updateMany({
      where: {
        phone,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });

    // 5. Create OTP log
    const otpLog = await prisma.otpLog.create({
      data: {
        id: uuidv4(),
        customerId: resolvedCustomerId,
        phone,
        otp: hashedOtp,
        expiresAt,
        maxAttempts: OTP_MAX_ATTEMPTS,
      },
    });

    // 6. Send via WhatsApp
    const waResponse = await this.waService.sendOtp({
      to: phone,
      otp,
      expiryMinutes: OTP_EXPIRY_MINUTES,
    });

    // 7. Log the message
    await prisma.message.create({
      data: {
        id: uuidv4(),
        customerId: resolvedCustomerId,
        type: 'OTP',
        status: 'SENT',
        waMessageId: waResponse.messages[0]?.id,
        templateName: process.env.WHATSAPP_OTP_TEMPLATE_NAME || 'authentication_otp',
        sentAt: new Date(),
      },
    });

    console.log(`[OTP] Sent to ${phone}, expires at ${expiresAt.toISOString()}`);

    return {
      success: true,
      otpLogId: otpLog.id,
      expiresAt,
      waMessageId: waResponse.messages[0]?.id,
    };
  }

  // ─── Verify OTP ───────────────────────────────────────────────────────────
  async verifyOtp(phone: string, inputOtp: string): Promise<OtpVerifyResult> {
    // 1. Find the latest pending OTP for this phone
    const otpLog = await prisma.otpLog.findFirst({
      where: {
        phone,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpLog) {
      return { success: false, message: 'No active OTP found. Please request a new one.' };
    }

    // 2. Check attempt count
    if (otpLog.attempts >= otpLog.maxAttempts) {
      await prisma.otpLog.update({
        where: { id: otpLog.id },
        data: { status: 'EXHAUSTED' },
      });
      return { success: false, message: 'Too many attempts. Please request a new OTP.' };
    }

    // 3. Verify hashed OTP
    const isValid = await bcrypt.compare(inputOtp, otpLog.otp);

    // 4. Increment attempts
    await prisma.otpLog.update({
      where: { id: otpLog.id },
      data: {
        attempts: otpLog.attempts + 1,
        ...(isValid ? { status: 'VERIFIED', verifiedAt: new Date() } : {}),
        ...(!isValid && otpLog.attempts + 1 >= otpLog.maxAttempts ? { status: 'EXHAUSTED' } : {}),
      },
    });

    if (!isValid) {
      const remaining = otpLog.maxAttempts - otpLog.attempts - 1;
      return {
        success: false,
        message: remaining > 0
          ? `Incorrect OTP. ${remaining} attempt(s) remaining.`
          : 'Incorrect OTP. No more attempts allowed.',
      };
    }

    return { success: true, message: 'OTP verified successfully.' };
  }
}

export const otpService = new OtpService();
