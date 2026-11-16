import { IsInt, IsIn, IsOptional } from 'class-validator';

export class AsignarComprobanteDto {
  @IsInt()
  facturaId: number;

  @IsInt()
  comprobanteId: number;
}

export class ClasificarComprobanteDto {
  @IsInt()
  comprobanteId: number;

  @IsOptional()
  @IsIn(['transferencia', 'proveedor'])
  tipo?: 'transferencia' | 'proveedor' | null;
}