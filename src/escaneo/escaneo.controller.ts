import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { EscaneoService } from './escaneo.service';
import { FacturasService } from '../facturas/facturas.service';
import { ComprobantesService } from '../comprobantes/comprobantes.service';

/** Raíz de archivos servidos por nginx (/archivos/...). */
const IMAGENES_DIR =
  process.env.IMAGENES_DIR || path.resolve(process.cwd(), 'archivos');

/**
 * Memoria temporal de previsualización (opción B de guardado):
 * `previsualizar` procesa y guarda el resultado en una carpeta temporal con un
 * `id`; `confirmar` recibe ese id y lo mueve a su destino final con el nombre
 * estructurado. Así no se reenvía la imagen dos veces y el cliente no elige
 * el path.
 */
const TMP_DIR = path.resolve(process.cwd(), '.escaneo_tmp');

@Controller('escaneo')
export class EscaneoController {
  private readonly logger = new Logger('Escaneo');

  constructor(
    private readonly escaneo: EscaneoService,
    private readonly facturas: FacturasService,
    private readonly comprobantes: ComprobantesService,
  ) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  /**
   * Fase 1: recibe la imagen, la procesa (recorte+realce, y enderezado si se
   * dan esquinas), la guarda temporalmente con un id y devuelve la referencia
   * (id + URL de vista previa). NO guarda en el destino final.
   */
  @Post('previsualizar')
  @UseInterceptors(
    FileInterceptor('archivo', {
      storage: diskStorage({
        destination: (_r, _f, cb) => cb(null, TMP_DIR),
        filename: (_r, f, cb) => cb(null, `${Date.now()}_${f.originalname.replace(/[^A-Za-z0-9._-]/g, '_')}`),
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async previsualizar(
    @UploadedFile() file?: Express.Multer.File,
    @Body() body?: { esquinas?: number[] },
  ) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo.');
    const rutaOriginal = file.path;
    try {
      const buffer = fs.readFileSync(rutaOriginal);
      const esquinas = Array.isArray(body?.esquinas) && body!.esquinas!.length === 8
        ? body!.esquinas
        : undefined;
      const resultado = await this.escaneo.procesar(buffer, esquinas);

      const id = crypto.randomBytes(8).toString('hex');
      const tmpFinal = path.join(TMP_DIR, `${id}.jpg`);
      fs.writeFileSync(tmpFinal, resultado.data);

      // limpia la subida original (ya procesada)
      fs.rmSync(rutaOriginal, { force: true });

      return {
        ok: true,
        id,
        // la imagen temporal se sirve por nginx en /escaneo_tmp/<id>.jpg
        preview_url: `/escaneo_tmp/${id}.jpg`,
        width: resultado.width,
        height: resultado.height,
      };
    } catch (e) {
      fs.rmSync(rutaOriginal, { force: true });
      this.logger.error('previsualizar error', e as any);
      throw new BadRequestException('No se pudo procesar la imagen.');
    }
  }

  /**
   * Fase 2: recibe el id de previsualizar + metadatos (tipo, fecha, proveedor,
   * referencia, total) y guarda el archivo en su destino final estructurado
   * (facturas/AAAA/MM/... o comprobantes/...), creando el registro en BD.
   */
  @Post('confirmar')
  async confirmar(
    @Body()
    body: {
      id: string;
      tipo: 'factura' | 'comprobante_pago' | 'comprobante_transferencia';
      fecha?: string;
      referencia?: string;
      proveedor?: string;
      total?: number;
    },
  ) {
    if (!body?.id) throw new BadRequestException('Falta el id de previsualización.');
    const tmpFinal = path.join(TMP_DIR, `${body.id}.jpg`);
    if (!fs.existsSync(tmpFinal)) throw new NotFoundException('La previsualización venció. Escanea de nuevo.');
    if (!body.tipo) throw new BadRequestException('Falta el tipo de documento.');

    // Construir el nombre estructurado: AAAAMMDD_REF_PROVEEDOR.jpg
    let fecha = body.fecha || '';
    let aaammdd = fecha.replace(/[^0-9]/g, '');
    if (aaammdd.length !== 8 && aaammdd.length >= 4) aaammdd = `${aaammdd}0000`.slice(0, 8);
    if (aaammdd.length < 8) aaammdd = '00000000';
    const prov = (body.proveedor || '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ._-]/g, '');
    const ref = (body.referencia || '').trim().replace(/[^A-Za-z0-9._-]/g, '');
    const nombre = `${aaammdd}_${ref || 'SREF'}_${prov || 'SPROV'}.jpg`;

    // Destino: facturas/AAAA/MM/  |  comprobantes/<tipo>/
    let rutaRel: string;
    const aa = aaammdd.slice(0, 4);
    const mm = aaammdd.slice(4, 6);
    if (body.tipo === 'factura') {
      rutaRel = path.join('facturas', aa, mm, nombre);
    } else {
      const sub = body.tipo === 'comprobante_pago' ? 'de_pago' : 'de_transferencia';
      rutaRel = path.join('comprobantes', sub, nombre);
    }
    const destinoFinal = path.join(IMAGENES_DIR, rutaRel);
    fs.mkdirSync(path.dirname(destinoFinal), { recursive: true });
    fs.copyFileSync(tmpFinal, destinoFinal);
    fs.rmSync(tmpFinal, { force: true });

    // Crear registro en BD
    let creado: any = null;
    const archivo = rutaRel.replace(/\\/g, '/');
    try {
      if (body.tipo === 'factura') {
        creado = await this.facturas.create({
          proveedor: body.proveedor || undefined,
          fecha: body.fecha || undefined,
          numero_factura: body.referencia || undefined,
          total_con_impuestos: body.total ?? undefined,
          archivo,
        });
      } else {
        creado = await this.comprobantes.create({
          beneficiario_emisor: body.proveedor || undefined,
          fecha: body.fecha || undefined,
          referencia: body.referencia || undefined,
          total_con_impuestos: body.total ?? undefined,
          archivo,
        });
      }
    } catch (e: any) {
      this.logger.warn(`Al guardar el registro falló (quizá duplicado): ${(e?.response?.message || e?.message)}`);
      // El archivo ya está en destino; la duplicidad se reporta sin romper.
    }

    return {
      ok: true,
      archivo,
      archivo_url: `/archivos/${archivo}`,
      id: (creado as any)?.id ?? null,
      detalle: creado ? true : false,
    };
  }
}