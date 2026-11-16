import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AddPedidoItemDto {
  @IsInt()
  id_producto: number;

  @IsOptional()
  @IsString()
  tamanio?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(1)
  cantidad?: number;

  @IsOptional()
  @IsString()
  nota?: string | null;

  @IsOptional()
  @IsNumber()
  costo_unitario?: number | null;
}

export class CreatePedidoDto {
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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddPedidoItemDto)
  items: AddPedidoItemDto[];
}

export class AgregarItemsPedidoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddPedidoItemDto)
  items: AddPedidoItemDto[];
}

export class CambiarEstadoCocinaDto {
  @IsString()
  estado_cocina: string;
}

export class CobrarPedidoDto {
  @IsOptional()
  @IsInt()
  id_forma_pago?: number | null;
}

export class SolicitarAnulacionDto {
  @IsOptional()
  @IsString()
  motivo?: string | null;
}

export class AnularPedidoDto {
  @IsOptional()
  @IsString()
  password?: string;
}
