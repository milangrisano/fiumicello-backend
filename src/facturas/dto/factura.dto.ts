import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFacturaItemDto {
  @IsOptional() @IsString() descripcion?: string;
  @IsOptional() @IsNumber() cantidad?: number;
  @IsOptional() @IsNumber() precio_unitario?: number;
  @IsOptional() @IsNumber() base_imponible?: number;
  @IsOptional() @IsNumber() iva?: number;
  @IsOptional() @IsNumber() total?: number;
  @IsOptional() @IsString() categoria?: string;
  @IsOptional() @IsString() numero_factura?: string;
  @IsOptional() @IsString() fecha_factura?: string;
  @IsOptional() @IsString() proveedor?: string;
  @IsOptional() @IsString() moneda?: string;
}

export class CreateFacturaDto {
  @IsOptional() @IsString() fecha?: string;
  @IsOptional() @IsString() numero_factura?: string;
  @IsOptional() @IsString() proveedor?: string;
  @IsOptional() @IsString() concepto?: string;
  @IsOptional() @IsNumber() base_imponible?: number;
  @IsOptional() @IsNumber() iva?: number;
  @IsOptional() @IsNumber() total_con_impuestos?: number;
  @IsOptional() @IsString() moneda?: string;
  @IsOptional() @IsString() metodo_pago?: string;
  @IsOptional() @IsString() fecha_pago?: string;
  @IsOptional() @IsString() estado?: string;
  @IsOptional() @IsString() archivo?: string;
  @IsOptional() @IsString() nota?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateFacturaItemDto)
  items?: CreateFacturaItemDto[];
}

export class UpdateFacturaDto {
  @IsOptional() @IsString() fecha?: string;
  @IsOptional() @IsString() numero_factura?: string;
  @IsOptional() @IsString() proveedor?: string;
  @IsOptional() @IsString() concepto?: string;
  @IsOptional() @IsNumber() base_imponible?: number;
  @IsOptional() @IsNumber() iva?: number;
  @IsOptional() @IsNumber() total_con_impuestos?: number;
  @IsOptional() @IsString() moneda?: string;
  @IsOptional() @IsString() metodo_pago?: string;
  @IsOptional() @IsString() fecha_pago?: string;
  @IsOptional() @IsString() estado?: string;
  @IsOptional() @IsString() archivo?: string;
  @IsOptional() @IsString() nota?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateFacturaItemDto)
  items?: CreateFacturaItemDto[];
}