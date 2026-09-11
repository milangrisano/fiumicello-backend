import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TurnoCaja } from '../entities/turno-caja.entity';
import { MovimientoCaja } from '../entities/movimiento-caja.entity';
import { PagoPropina } from '../entities/pago-propina.entity';
import { Venta } from '../entities/venta.entity';
import { TurnosCajaService } from './turnos-caja.service';
import { MovimientosCajaService } from './movimientos-caja.service';
import { PagosPropinaService } from './pagos-propina.service';
import { TurnosCajaController } from './turnos-caja.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TurnoCaja, MovimientoCaja, PagoPropina, Venta])],
  controllers: [TurnosCajaController],
  providers: [TurnosCajaService, MovimientosCajaService, PagosPropinaService],
  exports: [TurnosCajaService],
})
export class TurnosCajaModule {}
