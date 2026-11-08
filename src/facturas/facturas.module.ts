import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Factura } from '../entities/factura.entity';
import { FacturaItem } from '../entities/factura-item.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { FacturasController } from './facturas.controller';
import { FacturasService } from './facturas.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Factura, FacturaItem]),
    RealtimeModule,
  ],
  controllers: [FacturasController],
  providers: [FacturasService],
  exports: [FacturasService],
})
export class FacturasModule {}