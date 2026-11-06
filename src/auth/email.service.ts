import { Logger } from '@nestjs/common';

/**
 * Email delivery contract (abstract class used as the DI token).
 *
 * The rest of the app depends on this class, NOT on a concrete provider.
 * This lets us swap the "simulated" delivery (used now, logs the code) for a
 * real provider later WITHOUT touching any other code — the protocol is
 * fixed, only the implementation changes.
 */
export abstract class EmailService {
  abstract sendVerificationCode(toEmail: string, code: string): Promise<void>;
  abstract sendResetToken(toEmail: string, resetToken: string): Promise<void>;

  /**
   * Notify a user about an account-status change (e.g. pending approval,
   * approved, disabled).
   */
  abstract sendAccountStatus(toEmail: string, message: string): Promise<void>;
}

/**
 * Simulation implementation — used when no real provider is configured.
 *
 * Does NOT send any real email (avoids SMTP usage / getting the sender banned
 * during development). Instead it logs the code/token to the backend logs,
 * enough for local/Tailscale testing.
 */
export class EmailServiceSimulado extends EmailService {
  private readonly logger = new Logger('EmailServiceSimulado');

  async sendVerificationCode(toEmail: string, code: string): Promise<void> {
    this.logger.log(
      `[SIMULADO] Codigo de verificacion para ${toEmail}: ${code}`,
    );
  }

  async sendResetToken(toEmail: string, resetToken: string): Promise<void> {
    this.logger.log(
      `[SIMULADO] Token de reseteo para ${toEmail}: ${resetToken}`,
    );
  }

  async sendAccountStatus(toEmail: string, message: string): Promise<void> {
    this.logger.log(
      `[SIMULADO] Notificacion de cuenta para ${toEmail}: ${message}`,
    );
  }
}

/**
 * Real implementation using Resend (https://resend.com) via its HTTP API.
 * No extra npm dependency: uses the native `fetch` available in Node 18+.
 *
 * Env vars:
 *   RESEND_API_KEY  — API key de Resend (obligatoria para enviar).
 *   MAIL_FROM       — remitente verificado, p.ej. "Fiumicello <no-reply@fiumicello.site>".
 */
export class EmailServiceReal extends EmailService {
  private readonly logger = new Logger('EmailServiceReal');
  private readonly apiKey: string;
  private readonly from: string;

  constructor() {
    super();
    this.apiKey = (process.env.RESEND_API_KEY || '').trim();
    this.from = (process.env.MAIL_FROM || 'Fiumicello <no-reply@fiumicello.site>').trim();
    if (!this.apiKey) {
      this.logger.warn(
        'RESEND_API_KEY no definida: los correos NO se enviarán (se registrará un aviso).',
      );
    }
  }

  /** Envía un correo HTML vía la API de Resend. Lanza si falla. */
  private async enviar(toEmail: string, subject: string, html: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn(`[SIN API KEY] No se envió "${subject}" a ${toEmail}.`);
      return;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [toEmail],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`Resend falló (${res.status}) para ${toEmail}: ${body}`);
      throw new Error(`No se pudo enviar el correo (${res.status}).`);
    }
    this.logger.log(`Correo "${subject}" enviado a ${toEmail}.`);
  }

  async sendVerificationCode(toEmail: string, code: string): Promise<void> {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#2FB9A6">Fiumicello</h2>
        <p>Tu código de verificación es:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#111">${code}</p>
        <p style="color:#666;font-size:13px">Si no solicitaste este registro, ignora este correo.</p>
      </div>`;
    await this.enviar(toEmail, 'Código de verificación — Fiumicello', html);
  }

  async sendResetToken(toEmail: string, resetToken: string): Promise<void> {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#2FB9A6">Fiumicello</h2>
        <p>Para restablecer tu contraseña usa este código:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#111">${resetToken}</p>
        <p style="color:#666;font-size:13px">Si no lo solicitaste, ignora este correo.</p>
      </div>`;
    await this.enviar(toEmail, 'Recuperar contraseña — Fiumicello', html);
  }

  async sendAccountStatus(toEmail: string, message: string): Promise<void> {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#2FB9A6">Fiumicello</h2>
        <p>${message}</p>
      </div>`;
    await this.enviar(toEmail, 'Estado de tu cuenta — Fiumicello', html);
  }
}
