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
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'fiumicello',
      entities: [Factura, FacturaItem, ComprobantePago],
      synchronize: true, // creates tables in dev; switch to migrations for prod control
      logging: false,
    }),
    FacturasModule,
    ComprobantesModule,
    GastosModule,
  ],
})
export class AppModule {}