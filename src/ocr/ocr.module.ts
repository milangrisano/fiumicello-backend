import { Module } from '@nestjs/common';
import { OcrService } from './ocr.service';
import { SidecarService } from './sidecar.service';
import { OcrController } from './ocr.controller';
import { FacturasModule } from '../facturas/facturas.module';
import { ComprobantesModule } from '../comprobantes/comprobantes.module';

@Module({
  imports: [FacturasModule, ComprobantesModule],
  controllers: [OcrController],
  providers: [OcrService, SidecarService],
  exports: [OcrService, SidecarService],
})
export class OcrModule {}