import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pedido } from '../entities/pedido.entity';
import { PedidoItem } from '../entities/pedido-item.entity';
import { FormaPago } from '../entities/forma-pago.entity';
import { Venta } from '../entities/venta.entity';
import { VentaItem } from '../entities/venta-item.entity';
import { PedidosService } from './pedidos.service';
import { PedidosController } from './pedidos.controller';
import { TurnosCajaModule } from '../turnos-caja/turnos-caja.module';

@Module({
  imports: [TypeOrmModule.forFeature([Pedido, PedidoItem, FormaPago, Venta, VentaItem]), TurnosCajaModule],
  controllers: [PedidosController],
  providers: [PedidosService],
  exports: [PedidosService],
})
export class PedidosModule {}