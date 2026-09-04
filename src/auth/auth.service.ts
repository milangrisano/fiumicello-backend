import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Usuario, UserRole } from '../entities/usuario.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(Usuario)
    private readonly usuarios: Repository<Usuario>,
    private readonly jwt: JwtService,
  ) {}

  async validateUser(username: string, password: string) {
    const user = await this.usuarios.findOneBy({ username });
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return null;
    return user;
  }

  async login(username: string, password: string) {
    const user = await this.validateUser(username, password);
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }
    const payload = { username: user.username, sub: user.id, rol: user.rol };
    return {
      access_token: await this.jwt.signAsync(payload),
      user: { id: user.id, username: user.username, rol: user.rol },
    };
  }

  /**
   * Seed initial users from env if the table is empty.
   * Admin (Enrique) and editor (herb) credentials live in .env — never in code.
   */
  async seedInitialUsers() {
    const count = await this.usuarios.count();
    if (count > 0) return;

    // Forzar rol admin si viene en la variable (sanitización mínima).
    const adminRol: UserRole = (process.env.ADMIN_ROLE || 'admin') === 'admin' ? 'admin' : 'admin';

    const adminPass = process.env.ADMIN_PASSWORD;
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const editorPass = process.env.EDITOR_PASSWORD;
    const editorUser = process.env.EDITOR_USERNAME || 'herb';

    if (!adminPass || !editorPass) {
      this.logger.warn(
        'SKIP seed: ADMIN_PASSWORD/EDITOR_PASSWORD no definidas en .env. No se crearon usuarios.',
      );
      return;
    }

    const adminHash = await bcrypt.hash(adminPass, 10);
    const editorHash = await bcrypt.hash(editorPass, 10);
    const now = new Date().toISOString();

    await this.usuarios.save([
      this.usuarios.create({ username: adminUser, password_hash: adminHash, rol: adminRol, created_at: now }),
      this.usuarios.create({ username: editorUser, password_hash: editorHash, rol: 'editor', created_at: now }),
    ]);
    this.logger.log(`Seed: creados usuarios '${adminUser}' (admin) y '${editorUser}' (editor).`);
  }
}