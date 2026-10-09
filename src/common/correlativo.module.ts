import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CorrelativoService } from './correlativo.service';

@Module({
  imports: [],
  providers: [CorrelativoService],
  exports: [CorrelativoService],
})
export class CorrelativoModule {}