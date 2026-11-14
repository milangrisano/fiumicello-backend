import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../entities/usuario.entity';

export interface JwtUser {
  id: number;
  email: string | null;
  rol: UserRole;
  /** Solo presente en tokens de servicio (ej. 'herb'). Null en usuarios humanos. */
  nombreServicio?: string | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as JwtUser;
  },
);