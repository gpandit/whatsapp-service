import axios, { AxiosInstance } from 'axios';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters: Array<{
    type: 'text' | 'image' | 'document' | 'video' | 'currency' | 'date_time';
    text?: string;
    image?: { link: string };
    document?: { link: string; filename: string };
  }>;
  sub_type?: 'quick_reply' | 'url';
  index?: string;
}

export interface SendTemplatePayload {
  to: string;           // E.164 phone: +1234567890
  templateName: string;
  language?: string;
  components?: TemplateComponent[];
}

export interface SendTextPayload {
  to: string;
  message: string;
  previewUrl?: boolean;
}

export interface SendOtpPayload {
  to: string;
  otp: string;
  expiryMinutes?: number;
}

export interface WhatsAppMessageResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string; message_status?: string }>;
}

// ─── WhatsApp Cloud API Service ───────────────────────────────────────────────

export class WhatsAppService {
  private client: AxiosInstance;
  private phoneNumberId: string;
  private businessAccountId: string;

  constructor() {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    this.businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';

    if (!token || !this.phoneNumberId) {
      throw new Error('Missing WhatsApp configuration. Check env vars: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID');
    }

    this.client = axios.create({
      baseURL: `https://graph.facebook.com/v18.0`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  // ─── Send Template Message (for marketing + transactional) ──────────────────
  async sendTemplate(payload: SendTemplatePayload): Promise<WhatsAppMessageResponse> {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: payload.to,
      type: 'template',
      template: {
        name: payload.templateName,
        language: {
          code: payload.language || 'en_US',
        },
        components: payload.components || [],
      },
    };

    try {
      const response = await this.client.post<WhatsAppMessageResponse>(
        `/${this.phoneNumberId}/messages`,
        body
      );
      console.log(`[WhatsApp] Template sent to ${payload.to}:`, response.data.messages[0].id);
      return response.data;
    } catch (error: any) {
      const errDetail = error.response?.data?.error;
      console.error('[WhatsApp] Template send failed:', errDetail || error.message);
      throw new Error(
        errDetail
          ? `WhatsApp Error ${errDetail.code}: ${errDetail.message}`
          : error.message
      );
    }
  }

  // ─── Send Free Text (only within 24hr customer-initiated window) ─────────────
  async sendText(payload: SendTextPayload): Promise<WhatsAppMessageResponse> {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: payload.to,
      type: 'text',
      text: {
        preview_url: payload.previewUrl || false,
        body: payload.message,
      },
    };

    try {
      const response = await this.client.post<WhatsAppMessageResponse>(
        `/${this.phoneNumberId}/messages`,
        body
      );
      return response.data;
    } catch (error: any) {
      const errDetail = error.response?.data?.error;
      throw new Error(errDetail ? `WhatsApp Error ${errDetail.code}: ${errDetail.message}` : error.message);
    }
  }

  // ─── Send OTP via Authentication Template ───────────────────────────────────
  // Uses Meta's built-in "authentication" template (auto-approved, no custom template needed)
  async sendOtp(payload: SendOtpPayload): Promise<WhatsAppMessageResponse> {
    const expiryMinutes = payload.expiryMinutes || 10;

    // If you have a custom OTP template approved by Meta, use that.
    // Otherwise use Meta's native authentication template:
    const otpTemplateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME || 'authentication_otp';

    // Native auth template structure
    const components: TemplateComponent[] = [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: payload.otp },
          { type: 'text', text: `${expiryMinutes} minutes` },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: payload.otp }],
      },
    ];

    return this.sendTemplate({
      to: payload.to,
      templateName: otpTemplateName,
      components,
    });
  }

  // ─── Mark Message as Read ────────────────────────────────────────────────────
  async markAsRead(messageId: string): Promise<void> {
    await this.client.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  }

  // ─── Fetch Approved Templates from Meta ─────────────────────────────────────
  async getTemplates(): Promise<any[]> {
    const response = await this.client.get(
      `/${this.businessAccountId}/message_templates`,
      { params: { limit: 100, status: 'APPROVED' } }
    );
    return response.data.data || [];
  }

  // ─── Verify Webhook Signature ────────────────────────────────────────────────
  static verifyWebhookSignature(payload: string, signature: string, appSecret: string): boolean {
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', appSecret)
      .update(payload)
      .digest('hex');
    return `sha256=${expectedSignature}` === signature;
  }
}

export const whatsAppService = new WhatsAppService();
