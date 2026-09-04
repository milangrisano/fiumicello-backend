import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ---- Registration: step 1 - request a verification code ----
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Body() body: { email?: string }) {
    return this.auth.requestRegister(body.email || '');
  }

  // ---- Registration: step 2 - verify code and set password ----
  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body() body: { email?: string; code?: string; password?: string },
  ) {
    await this.auth.verifyAndCreate(body.email || '', body.code || '', body.password || '');
    return { ok: true, message: 'Cuenta verificada. Queda pendiente de aprobación.' };
  }

  // ---- Login ----
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: { email?: string; password?: string }) {
    return this.auth.login(body.email || '', body.password || '');
  }

  // ---- Password reset: request ----
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() body: { email?: string }) {
    return this.auth.requestReset(body.email || '');
  }

  // ---- Password reset: confirm ----
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() body: { email?: string; token?: string; password?: string },
  ) {
    await this.auth.resetPassword(body.email || '', body.token || '', body.password || '');
    return { ok: true, message: 'Contraseña restablecida.' };
  }

  // ---- Admin: list pending approvals ----
  @Get('usuarios/pendientes')
  @Roles('superadmin', 'admin')
  async pendientes() {
    return this.auth.listPendientes();
  }

  // ---- Admin: approve a user ----
  @Post('usuarios/:id/aprobar')
  @Roles('superadmin', 'admin')
  @HttpCode(HttpStatus.OK)
  async aprobar(@Param('id', ParseIntPipe) id: number) {
    await this.auth.approveUser(id);
    return { ok: true, id };
  }

  // ---- Superadmin: list service tokens ----
  @Get('servicios')
  @Roles('superadmin')
  async listServicios() {
    return this.auth.listServiceTokens();
  }

  // ---- Superadmin: generate a service token (shown once) ----
  @Post('servicios')
  @Roles('superadmin')
  @HttpCode(HttpStatus.CREATED)
  async generarServicio(@Body() body: { nombre?: string }) {
    return this.auth.generateServiceToken(body.nombre || '');
  }

  // ---- Superadmin: revoke a service token ----
  @Delete('servicios/:id')
  @Roles('superadmin')
  @HttpCode(HttpStatus.OK)
  async revocar(@Param('id', ParseIntPipe) id: number) {
    await this.auth.revokeServiceToken(id);
    return { ok: true, id };
  }
}