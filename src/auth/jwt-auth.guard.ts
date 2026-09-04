import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthService } from './auth.service';

/**
 * Global auth guard.
 * Accepts either:
 *   - a JWT bearer token (human users, via passport-jwt), or
 *   - a service API token (e.g. the `herb` agent) resolved by AuthService.
 * Public routes (@Public) bypass auth entirely.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers?.authorization;
    // If it's not a Bearer JWT, try service token.
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      // Is it a JWT (3 dot-separated parts)? Then let passport validate it.
      if (token.split('.').length === 3) {
        return (await super.canActivate(context)) as boolean;
      }
      // Otherwise try as a service token.
      const svc = await this.auth.findByApiToken(token);
      if (svc && svc.estado === 'aprobado') {
        req.user = { id: svc.id, email: svc.email, rol: svc.rol };
        return true;
      }
      return false;
    }

    // No bearer header -> unauthorized.
    return false;
  }
}