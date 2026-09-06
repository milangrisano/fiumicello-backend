import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Factura } from './entities/factura.entity';
import { FacturaItem } from './entities/factura-item.entity';
import { ComprobantePago } from './entities/comprobante.entity';
import { Usuario } from './entities/usuario.entity';
import { Rol } from './entities/rol.entity';
import { CategoriaCarta } from './entities/categoria-carta.entity';
import { ItemCarta } from './entities/item-carta.entity';
import { HealthController } from './health.controller';
import { FacturasModule } from './facturas/facturas.module';
import { ComprobantesModule } from './comprobantes/comprobantes.module';
import { GastosModule } from './gastos/gastos.module';
import { CartaModule } from './carta/carta.module';
import { CartaService } from './carta/carta.service';
import { AuthModule } from './auth/auth.module';
import { AuthService } from './auth/auth.service';
import { RolesService } from './auth/roles.service';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { PermisosGuard } from './auth/permisos.guard';

@Module({
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermisosGuard },
  ],
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'fiumicello',
      entities: [Factura, FacturaItem, ComprobantePago, Usuario, Rol, CategoriaCarta, ItemCarta],
      synchronize: true,
      logging: false,
    }),
    FacturasModule,
    ComprobantesModule,
    GastosModule,
    CartaModule,
    AuthModule,
  ],
})
export class AppModule implements OnModuleInit {
  constructor(
    private readonly auth: AuthService,
    private readonly roles: RolesService,
    private readonly carta: CartaService,
  ) {}

  async onModuleInit() {
    await this.auth.seedInitialUsers();
    await this.roles.seedBaseRoles();
    await this.carta.seedIfEmpty();
  }
}