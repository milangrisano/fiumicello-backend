import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Venta } from '../entities/venta.entity';
import { VentaItem } from '../entities/venta-item.entity';
import { FormaPago } from '../entities/forma-pago.entity';
import { VentasService } from './ventas.service';
import { VentasController } from './ventas.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Venta, VentaItem, FormaPago])],
  controllers: [VentasController],
  providers: [VentasService],
  exports: [VentasService],
})
export class VentasModule {}