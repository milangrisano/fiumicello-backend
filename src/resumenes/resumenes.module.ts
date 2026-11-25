import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Venta } from '../entities/venta.entity';
import { VentaItem } from '../entities/venta-item.entity';
import { Factura } from '../entities/factura.entity';
import { ComprobantePago } from '../entities/comprobante.entity';
import { ResumenesService } from './resumenes.service';
import { ResumenesController } from './resumenes.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Venta, VentaItem, Factura, ComprobantePago]),
    RealtimeModule,
  ],
  controllers: [ResumenesController],
  providers: [ResumenesService],
})
export class ResumenesModule {}