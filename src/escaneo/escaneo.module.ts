import { Module } from '@nestjs/common';
import { EscaneoService } from './escaneo.service';
import { EscaneoController } from './escaneo.controller';
import { FacturasModule } from '../facturas/facturas.module';
import { ComprobantesModule } from '../comprobantes/comprobantes.module';

@Module({
  imports: [FacturasModule, ComprobantesModule],
  controllers: [EscaneoController],
  providers: [EscaneoService],
  exports: [EscaneoService],
})
export class EscaneoModule {}