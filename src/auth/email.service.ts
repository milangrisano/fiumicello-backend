import { Logger } from '@nestjs/common';

/**
 * Email delivery contract (abstract class used as the DI token).
 *
 * The rest of the app depends on this class, NOT on a concrete provider.
 * This lets us swap the "simulated" delivery (used now, logs the code) for a
 * real SMTP/provider later WITHOUT touching any other code — the protocol is
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
 * Simulation implementation — active now.
 *
 * Does NOT send any real email (avoids SMTP usage / getting the sender banned
 * during development). Instead it logs the code/token to the backend logs,
 * enough for local/Tailscale testing. When a real provider is configured,
 * switch the provider to a class that extends EmailService (e.g. EmailServiceReal).
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
 * Real implementation — future (SMTP via nodemailer or a provider).
 * Same contract; only construction differs. Swapping requires no changes
 * to the controllers/services that use EmailService.
 */
export class EmailServiceReal extends EmailService {
  private readonly logger = new Logger('EmailServiceReal');

  // TODO: configure nodemailer/transporter here from SMTP_* env vars.
  constructor() {
    super();
    this.logger.warn(
      'EmailServiceReal no configurado: se usara envio real cuando se definan SMTP_*',
    );
  }

  async sendVerificationCode(_toEmail: string, _code: string): Promise<void> {
    this.logger.log('EmailServiceReal.sendVerificationCode (TODO: implementar SMTP).');
  }

  async sendResetToken(_toEmail: string, _resetToken: string): Promise<void> {
    this.logger.log('EmailServiceReal.sendResetToken (TODO: implementar SMTP).');
  }

  async sendAccountStatus(_toEmail: string, _message: string): Promise<void> {
    this.logger.log('EmailServiceReal.sendAccountStatus (TODO: implementar SMTP).');
  }
}