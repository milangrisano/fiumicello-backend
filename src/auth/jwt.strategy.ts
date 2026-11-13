import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '../entities/usuario.entity';
import { JwtUser } from './current-user.decorator';
import { requireEnv } from '../common/env';

export interface JwtPayload {
  sub: number;
  email: string | null;
  rol: UserRole;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireEnv('JWT_SECRET', 'secreto de firma JWT'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtUser> {
    return { id: payload.sub, email: payload.email ?? null, rol: payload.rol };
  }
}