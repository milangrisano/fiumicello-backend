import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Venta } from '../entities/venta.entity';
import { VentaItem } from '../entities/venta-item.entity';
import { ResumenesService } from './resumenes.service';
import { ResumenesController } from './resumenes.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Venta, VentaItem])],
  controllers: [ResumenesController],
  providers: [ResumenesService],
})
export class ResumenesModule {}