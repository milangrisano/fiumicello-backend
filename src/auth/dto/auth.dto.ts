import { IsOptional, IsString } from 'class-validator';

export class EmailDto {
  @IsOptional()
  @IsString()
  email?: string;
}

export class VerifyDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  password?: string;
}

export class VerifyCodeDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  code?: string;
}

export class LoginDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  password?: string;
}

export class ResetPasswordDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @IsString()
  password?: string;
}

export class CambiarContrasenaDto {
  @IsOptional()
  @IsString()
  passwordActual?: string;

  @IsOptional()
  @IsString()
  passwordNueva?: string;
}

export class EstadoUsuarioDto {
  @IsOptional()
  @IsString()
  estado?: string;
}

export class AsignarRolDto {
  @IsOptional()
  @IsString()
  rol?: string;
}

export class GenerarServicioDto {
  @IsOptional()
  @IsString()
  nombre?: string;
}
