import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ComprobantesService, ComprobantesFiltros } from './comprobantes.service';
import { CreateComprobanteDto, UpdateComprobanteDto } from './dto/comprobante.dto';
import { Roles } from '../auth/roles.decorator';

@Controller('comprobantes')
export class ComprobantesController {
  constructor(private readonly comprobantes: ComprobantesService) {}

  @Get()
  findAll(@Query() q: ComprobantesFiltros) {
    return this.comprobantes.findAll(q);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.comprobantes.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateComprobanteDto) {
    return this.comprobantes.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateComprobanteDto) {
    return this.comprobantes.update(id, dto);
  }

  @Delete(':id')
  @Roles('superadmin', 'admin')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.comprobantes.remove(id);
  }
}