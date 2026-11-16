import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AbrirTurnoDto {
  @IsNumber()
  @Min(0)
  efectivo_inicial: number;
}

export class CerrarTurnoDto {
  @IsNumber()
  @Min(0)
  efectivo_final: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  propina_efectivo?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  propina_otros?: number;
}

export class MovimientoCajaDto {
  @IsInt()
  id_turno: number;

  @IsString()
  concepto: string;

  @IsNumber()
  monto: number;

  @IsOptional()
  @IsInt()
  autorizado_por?: number;
}

export class PagarPropinaDto {
  @IsString()
  fecha_pago: string;

  @IsNumber()
  @Min(0)
  monto_efectivo: number;

  @IsNumber()
  @Min(0)
  monto_otros: number;

  @IsOptional()
  @IsInt()
  turnos_desde?: number;

  @IsOptional()
  @IsInt()
  turnos_hasta?: number;

  @IsOptional()
  @IsString()
  notas?: string;
}
