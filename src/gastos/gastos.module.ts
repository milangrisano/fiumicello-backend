import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Factura } from '../entities/factura.entity';
import { FacturaItem } from '../entities/factura-item.entity';
import { ComprobantePago } from '../entities/comprobante.entity';
import { GastosController } from './gastos.controller';
import { GastosService } from './gastos.service';

@Module({
  imports: [TypeOrmModule.forFeature([Factura, FacturaItem, ComprobantePago])],
  controllers: [GastosController],
  providers: [GastosService],
})
export class GastosModule {}