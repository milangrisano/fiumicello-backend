import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComprobantePago } from '../entities/comprobante.entity';
import { ComprobantesController } from './comprobantes.controller';
import { ComprobantesService } from './comprobantes.service';

@Module({
  imports: [TypeOrmModule.forFeature([ComprobantePago])],
  controllers: [ComprobantesController],
  providers: [ComprobantesService],
  exports: [ComprobantesService],
})
export class ComprobantesModule {}