import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CategoriaDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsInt()
  orden?: number;
}

export class TamanioDto {
  @IsString()
  nombre: string;

  @IsNumber()
  precio: number;
}

export class ItemCartaDto {
  @IsInt()
  id_categoria: number;

  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  descripcion?: string | null;

  @IsOptional()
  @IsNumber()
  precio?: number | null;

  @IsOptional()
  @IsNumber()
  precio_personal?: number | null;

  @IsOptional()
  @IsNumber()
  precio_mediana?: number | null;

  @IsOptional()
  @IsNumber()
  precio_grande?: number | null;

  @IsOptional()
  @IsNumber()
  costo?: number | null;

  @IsOptional()
  @IsInt()
  orden?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TamanioDto)
  tamanios?: TamanioDto[];
}
