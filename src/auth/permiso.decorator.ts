import { SetMetadata } from '@nestjs/common';

export const PERMISO_KEY = 'requierePermiso';
export const RequirePermiso = (...permisos: string[]) =>
  SetMetadata(PERMISO_KEY, permisos);