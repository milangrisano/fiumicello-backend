import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateComprobanteDto {
  @IsOptional() @IsString() fecha?: string;
  @IsOptional() @IsString() referencia?: string;
  @IsOptional() @IsString() beneficiario_emisor?: string;
  @IsOptional() @IsString() concepto?: string;
  @IsOptional() @IsNumber() total_con_impuestos?: number;
  @IsOptional() @IsString() moneda?: string;
  @IsOptional() @IsString() metodo_pago?: string;
  @IsOptional() @IsString() fecha_pago?: string;
  @IsOptional() @IsNumber() base_imponible?: number;
  @IsOptional() @IsNumber() iva?: number;
  @IsOptional() @IsString() categoria?: string;
  @IsOptional() @IsString() estado?: string;
  @IsOptional() @IsString() archivo?: string;
  @IsOptional() @IsString() nota?: string;
}

export class UpdateComprobanteDto {
  @IsOptional() @IsString() fecha?: string;
  @IsOptional() @IsString() referencia?: string;
  @IsOptional() @IsString() beneficiario_emisor?: string;
  @IsOptional() @IsString() concepto?: string;
  @IsOptional() @IsNumber() total_con_impuestos?: number;
  @IsOptional() @IsString() moneda?: string;
  @IsOptional() @IsString() metodo_pago?: string;
  @IsOptional() @IsString() fecha_pago?: string;
  @IsOptional() @IsNumber() base_imponible?: number;
  @IsOptional() @IsNumber() iva?: number;
  @IsOptional() @IsString() categoria?: string;
  @IsOptional() @IsString() estado?: string;
  @IsOptional() @IsString() archivo?: string;
  @IsOptional() @IsString() nota?: string;
}