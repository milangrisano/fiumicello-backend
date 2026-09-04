import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Factura } from './entities/factura.entity';
import { FacturaItem } from './entities/factura-item.entity';
import { ComprobantePago } from './entities/comprobante.entity';
import { Usuario } from './entities/usuario.entity';
import { HealthController } from './health.controller';
import { FacturasModule } from './facturas/facturas.module';
import { ComprobantesModule } from './comprobantes/comprobantes.module';
import { GastosModule } from './gastos/gastos.module';
import { AuthModule } from './auth/auth.module';
import { AuthService } from './auth/auth.service';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'fiumicello',
      entities: [Factura, FacturaItem, ComprobantePago, Usuario],
      synchronize: true, // creates tables in dev; switch to migrations for prod control
      logging: false,
    }),
    FacturasModule,
    ComprobantesModule,
    GastosModule,
    AuthModule,
  ],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly auth: AuthService) {}

  async onModuleInit() {
    await this.auth.seedInitialUsers();
  }
}