import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriaCarta } from '../entities/categoria-carta.entity';
import { ItemCarta } from '../entities/item-carta.entity';
import { CartaItemTamano } from '../entities/carta-item-tamano.entity';
import { VentaItem } from '../entities/venta-item.entity';
import { CartaService } from './carta.service';
import { CartaController } from './carta.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CategoriaCarta, ItemCarta, CartaItemTamano, VentaItem])],
  controllers: [CartaController],
  providers: [CartaService],
  exports: [CartaService],
})
export class CartaModule {}