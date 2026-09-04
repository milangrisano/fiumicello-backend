import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Factura } from './entities/factura.entity';
import { FacturaItem } from './entities/factura-item.entity';
import { ComprobantePago } from './entities/comprobante.entity';
import { HealthController } from './health.controller';
import { FacturasModule } from './facturas/facturas.module';
import { ComprobantesModule } from './comprobantes/comprobantes.module';
import { GastosModule } from './gastos/gastos.module';

@Module({
  controllers: [HealthController],
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: process.env.DB_PATH || '/data/payment_vouchers.db',
      entities: [Factura, FacturaItem, ComprobantePago],
      synchronize: false,
      logging: false,
    }),
    FacturasModule,
    ComprobantesModule,
    GastosModule,
  ],
})
export class AppModule {}