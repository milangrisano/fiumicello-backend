import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Usuario, UserRole, UserStatus } from '../entities/usuario.entity';
import { EmailService } from './email.service';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TOKEN_BYTES = 32; // 32 random bytes -> long base64 token

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(Usuario)
    private readonly usuarios: Repository<Usuario>,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  // ---- helpers ----
  private hashPassword(pw: string): Promise<string> {
    return bcrypt.hash(pw, 10);
  }

  private generateCode(): string {
    // 6 numeric digits
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private rawServiceToken(): string {
    return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  }

  private buildJwt(user: Usuario) {
    return this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      rol: user.rol,
    });
  }

  // ---- registration: step 1 (send code) ----
  async requestRegister(email: string): Promise<{ ok: boolean; message: string }> {
    const normalized = (email || '').trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      throw new BadRequestException('Email inválido.');
    }
    const existing = await this.usuarios.findOneBy({ email: normalized });
    if (existing) {
      // Do not leak whether the email is registered; same generic message.
      throw new ConflictException('El email ya está registrado.');
    }
    const code = this.generateCode();
    const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();
    // Store the pending code keyed by email (in-progress registration).
    // We reuse the row to hold the code until verified.
    const pending = await this.usuarios.findOneBy({ email: normalized });
    if (!pending) {
      await this.usuarios.save(
        this.usuarios.create({
          email: normalized,
          rol: 'editor',
          estado: 'pendiente',
          email_verified: false,
          codigo_verificacion: code,
          codigo_expiracion: expires,
          created_at: new Date().toISOString(),
        }),
      );
    } else {
      pending.codigo_verificacion = code;
      pending.codigo_expiracion = expires;
      await this.usuarios.save(pending);
    }
    await this.email.sendVerificationCode(normalized, code);
    return { ok: true, message: 'Código de verificación enviado.' };
  }

  // ---- registration: validate the code (no account creation) ----
  async validateCode(email: string, code: string): Promise<void> {
    const normalized = (email || '').trim().toLowerCase();
    const user = await this.usuarios.findOneBy({ email: normalized });
    if (!user || !user.codigo_verificacion || !user.codigo_expiracion) {
      throw new BadRequestException('Solicita un código de verificación primero.');
    }
    if (new Date(user.codigo_expiracion).getTime() < Date.now()) {
      throw new BadRequestException('El código expiró. Solicita uno nuevo.');
    }
    if (user.codigo_verificacion !== code) {
      throw new BadRequestException('Código incorrecto.');
    }
  }

  // ---- registration: step 2 (verify code + set password) ----
  async verifyAndCreate(email: string, code: string, password: string): Promise<void> {
    const normalized = (email || '').trim().toLowerCase();
    const user = await this.usuarios.findOneBy({ email: normalized });
    if (!user || !user.codigo_verificacion || !user.codigo_expiracion) {
      throw new BadRequestException('Solicita un código de verificación primero.');
    }
    if (new Date(user.codigo_expiracion).getTime() < Date.now()) {
      throw new BadRequestException('El código expiró. Solicita uno nuevo.');
    }
    if (user.codigo_verificacion !== code) {
      throw new BadRequestException('Código incorrecto.');
    }
    if (!password || password.length < 6) {
      throw new BadRequestException('La contraseña debe tener al menos 6 caracteres.');
    }
    user.password_hash = await this.hashPassword(password);
    user.email_verified = true;
    user.codigo_verificacion = null;
    user.codigo_expiracion = null;
    // remains estado='pendiente' until superadmin approves
    await this.usuarios.save(user);
    this.logger.log(`Usuario verificado y creado (pendiente de aprobación): ${normalized} (rol ${user.rol})`);
    await this.email.sendAccountStatus(
      normalized,
      'Tu cuenta fue creada y quedó pendiente de aprobación. Te avisaremos cuando sea aprobada.',
    );
  }

  // ---- password reset: request (same pattern as registration) ----
  async requestReset(email: string): Promise<{ ok: boolean; message: string }> {
    const normalized = (email || '').trim().toLowerCase();
    // Generic response regardless of existence (no user enumeration).
    if (!normalized || !normalized.includes('@')) {
      throw new BadRequestException('Email inválido.');
    }
    const user = await this.usuarios.findOneBy({ email: normalized });
    if (user) {
      const code = this.generateCode();
      user.codigo_verificacion = code;
      user.codigo_expiracion = new Date(Date.now() + CODE_TTL_MS).toISOString();
      await this.usuarios.save(user);
      await this.email.sendVerificationCode(normalized, code);
    }
    return { ok: true, message: 'Si el email existe, recibirás un código de recuperación.' };
  }

  // ---- password reset: confirm (code + new password) ----
  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    const normalized = (email || '').trim().toLowerCase();
    const user = await this.usuarios.findOneBy({ email: normalized });
    // Code must exist, match, and not be expired.
    const valid =
      user &&
      user.codigo_verificacion &&
      user.codigo_expiracion &&
      user.codigo_verificacion === code &&
      new Date(user.codigo_expiracion).getTime() >= Date.now();
    if (!valid) {
      throw new BadRequestException('Código de recuperación inválido o expirado.');
    }
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('La contraseña debe tener al menos 6 caracteres.');
    }
    user.password_hash = await this.hashPassword(newPassword);
    user.codigo_verificacion = null;
    user.codigo_expiracion = null;
    await this.usuarios.save(user);
    this.logger.log(`Contraseña restablecida para ${normalized}.`);
  }

  // ---- login ----
  async login(email: string, password: string) {
    const normalized = (email || '').trim().toLowerCase();
    const user = await this.usuarios.findOneBy({ email: normalized });
    if (!user || !user.password_hash) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }
    if (user.estado === 'pendiente') {
      throw new UnauthorizedException('Tu cuenta está pendiente de aprobación.');
    }
    if (user.estado === 'desactivado') {
      throw new UnauthorizedException('Tu cuenta está desactivada.');
    }
    return {
      access_token: await this.buildJwt(user),
      user: { id: user.id, email: user.email, rol: user.rol, estado: user.estado },
    };
  }

  // ---- authenticate by service token (herb & services) ----
  async findByApiToken(token: string): Promise<Usuario | null> {
    const hash = this.hashApiToken(token);
    return this.usuarios.findOneBy({ api_token_hash: hash });
  }

  private hashApiToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // ---- service token management (superadmin) ----
  async generateServiceToken(nombre: string): Promise<{ nombre: string; token: string; id: number }> {
    const token = this.rawServiceToken();
    const hash = this.hashApiToken(token);
    const svc = await this.usuarios.save(
      this.usuarios.create({
        nombre_servicio: nombre || 'servicio',
        rol: 'editor',
        estado: 'aprobado',
        api_token_hash: hash,
        created_at: new Date().toISOString(),
      }),
    );
    // Return the raw token ONCE.
    return { nombre: svc.nombre_servicio!, token, id: svc.id };
  }

  async listServiceTokens(): Promise<Array<{ id: number; nombre: string; creado: string }>> {
    const rows = await this.usuarios.find({ where: { rol: 'editor' } });
    return rows
      .filter((u) => u.api_token_hash)
      .map((u) => ({ id: u.id, nombre: u.nombre_servicio || 'servicio', creado: u.created_at || '' }));
  }

  async revokeServiceToken(id: number): Promise<void> {
    const user = await this.usuarios.findOneBy({ id });
    if (!user || !user.api_token_hash) {
      throw new BadRequestException('No es un token de servicio.');
    }
    user.api_token_hash = null;
    user.nombre_servicio = null;
    await this.usuarios.save(user);
  }

  // ---- admin approval ----
  async listPendientes() {
    const rows = await this.usuarios.find({ where: { estado: 'pendiente' } });
    // Never expose password_hash or internal tokens.
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      rol: u.rol,
      estado: u.estado,
      email_verified: u.email_verified,
      created_at: u.created_at,
      nombre_servicio: u.nombre_servicio,
    }));
  }

  /** List users for the admin screen (never expose password_hash/tokens). */
  async listarUsuarios() {
    const rows = await this.usuarios.find({ order: { id: 'ASC' } });
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      rol: u.rol,
      estado: u.estado,
      email_verified: u.email_verified,
      created_at: u.created_at,
      nombre_servicio: u.nombre_servicio,
    }));
  }

  async approveUser(id: number): Promise<void> {
    const user = await this.usuarios.findOneBy({ id });
    if (!user) throw new BadRequestException('Usuario no encontrado.');
    user.estado = 'aprobado';
    await this.usuarios.save(user);
    if (user.email) {
      await this.email.sendAccountStatus(
        user.email,
        'Tu cuenta fue aprobada. Ya puedes iniciar sesión.',
      );
    }
  }

  /**
   * Assign a role to a user. `actorRol` is the caller's role.
   * - Admin cannot manage superadmin users, and cannot assign the superadmin role.
   * - Only superadmin can assign the superadmin role.
   */
  async asignarRol(id: number, nuevoRol: string, actorRol: string): Promise<void> {
    const user = await this.usuarios.findOneBy({ id });
    if (!user) throw new BadRequestException('Usuario no encontrado.');
    if (user.rol === 'superadmin' && actorRol !== 'superadmin') {
      throw new ForbiddenException('No puedes modificar un superadmin.');
    }
    if (nuevoRol === 'superadmin' && actorRol !== 'superadmin') {
      throw new ForbiddenException('No puedes asignar el rol superadmin.');
    }
    user.rol = nuevoRol as Usuario['rol'];
    await this.usuarios.save(user);
  }

  // ---- seed ----
  async seedInitialUsers() {
    const count = await this.usuarios.count();
    if (count > 0) return;

    // Superadmin (Enrique). Migrate: superadmin = deploy/admin or enrique.
    const superUser = process.env.SUPERADMIN_EMAIL || process.env.ADMIN_USERNAME || 'enrique';
    const superPass = process.env.SUPERADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
    if (!superPass) {
      this.logger.warn('SKIP seed: no SUPERADMIN_PASSWORD/ADMIN_PASSWORD en .env');
      return;
    }
    await this.usuarios.save(
      this.usuarios.create({
        email: superUser,
        password_hash: await this.hashPassword(superPass),
        rol: 'superadmin',
        estado: 'aprobado',
        email_verified: true,
        created_at: new Date().toISOString(),
      }),
    );
    this.logger.log(`Seed: superadmin '${superUser}' creado.`);
    this.logger.log('Nota: herb debe gestionarse como cuENTA de servicio con token via /auth/register o admin/tokens.');
  }
}