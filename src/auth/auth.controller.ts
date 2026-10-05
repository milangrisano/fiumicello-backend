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
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService, REFRESH_COOKIE_NAME } from './auth.service';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';
import { RolesPermisosService } from './roles-permisos.service';
import { CurrentUser, JwtUser } from './current-user.decorator';

/** Lee el valor de una cookie desde el header 'Cookie' (sin cookie-parser). */
function cookieValue(req: Request, name: string): string {
  const header: string = req.headers?.cookie ?? '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return '';
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly permisos: RolesPermisosService,
  ) {}

  // ---- Permissions of the logged-in user (frontend menu/actions) ----
  @Get('mis-permisos')
  @Roles('superadmin', 'admin', 'encargado', 'cajero', 'cocinero', 'mesero', 'ayudante', 'editor')
  async misPermisos(@CurrentUser() user: JwtUser) {
    const permisos = await this.permisos.permisosDeUsuario(user.rol);
    return { rol: user.rol, permisos };
  }

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

  // ---- Registration: validate the code only (no account creation) ----
  @Public()
  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  async verifyCode(@Body() body: { email?: string; code?: string }) {
    await this.auth.validateCode(body.email || '', body.code || '');
    return { ok: true, message: 'Código válido.' };
  }

  // ---- Login ----
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { email?: string; password?: string },
    @Res() res: Response,
  ) {
    const r = await this.auth.login(body.email || '', body.password || '');
    // El refresh token se entrega SOLO como cookie HttpOnly (no en el body, no
    // legible por JS). El access va en el body para usarse en memoria.
    res.setHeader('Set-Cookie', this.auth.refreshCookie(r.refresh_token, AuthService.cookieSecure));
    res.status(HttpStatus.OK).json({ access_token: r.access_token, user: r.user });
  }

  // ---- Refresh de sesión (lee la cookie HttpOnly, rota y emite access nuevo) ----
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res() res: Response) {
    const raw = cookieValue(req, REFRESH_COOKIE_NAME);
    const r = await this.auth.refresh(raw);
    res.setHeader('Set-Cookie', this.auth.refreshCookie(r.refresh_token, AuthService.cookieSecure));
    res.status(HttpStatus.OK).json({ access_token: r.access_token, user: r.user });
  }

  // ---- Logout: revoca el refresh de este dispositivo y borra la cookie ----
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res() res: Response) {
    const raw = cookieValue(req, REFRESH_COOKIE_NAME);
    await this.auth.logout(raw);
    res.setHeader('Set-Cookie', this.auth.refreshCookie(null, AuthService.cookieSecure));
    res.status(HttpStatus.OK).json({ ok: true, message: 'Sesión cerrada.' });
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

  // ---- Admin: list all users ----
  @Get('usuarios')
  @Roles('superadmin', 'admin')
  async listarUsuarios() {
    return this.auth.listarUsuarios();
  }

  // ---- Admin: approve a user ----
  @Post('usuarios/:id/aprobar')
  @Roles('superadmin', 'admin')
  @HttpCode(HttpStatus.OK)
  async aprobar(@Param('id', ParseIntPipe) id: number) {
    await this.auth.approveUser(id);
    return { ok: true, id };
  }

  // ---- Admin: assign a role to a user ----
  @Post('usuarios/:id/rol')
  @Roles('superadmin', 'admin')
  @HttpCode(HttpStatus.OK)
  async asignarRol(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { rol?: string },
    @CurrentUser() user: JwtUser,
  ) {
    await this.auth.asignarRol(id, body.rol || '', user.rol);
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