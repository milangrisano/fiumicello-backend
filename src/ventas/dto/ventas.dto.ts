import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateVentaItemDto {
  @IsInt()
  id_producto: number;

  @IsOptional()
  @IsString()
  tamanio?: string | null;

  @IsNumber()
  @Min(1)
  cantidad: number;
}

export class CreateVentaDto {
  @IsIn(['mesa', 'para_llevar', 'domicilio'])
  escenario: 'mesa' | 'para_llevar' | 'domicilio';

  @IsOptional()
  @IsString()
  numero_mesa?: string | null;

  @IsOptional()
  @IsString()
  cliente_nombre?: string | null;

  @IsOptional()
  @IsString()
  direccion?: string | null;

  @IsOptional()
  @IsString()
  telefono?: string | null;

  @IsOptional()
  @IsInt()
  id_forma_pago?: number | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVentaItemDto)
  items: CreateVentaItemDto[];
}

export class CrearFormaPagoDto {
  @IsString()
  nombre: string;
}

export class ActualizarFormaPagoDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
