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
import { OcrService } from '../ocr/ocr.service';
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
    private readonly ocr: OcrService,
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
      // esquinas llega como array (JSON) o como string CSV (multipart) "x1,y1,..."
      let esquinas: number[] | undefined = undefined;
      const raw = body?.esquinas;
      if (Array.isArray(raw)) {
        if (raw.length === 8) esquinas = raw.map(Number);
      } else if (typeof raw === 'string') {
        const parts = raw.split(',').map((s) => Number(s.trim()));
        if (parts.length === 8 && parts.every((n) => !Number.isNaN(n))) esquinas = parts;
      }
      const resultado = await this.escaneo.procesar(buffer, esquinas);

      const id = crypto.randomBytes(8).toString('hex');
      const tmpFinal = path.join(TMP_DIR, `${id}.jpg`);
      fs.writeFileSync(tmpFinal, resultado.data);

      // dimensiones de la imagen ORIGINAL (para que el frontend convierta las
      // posiciones de los handles de esquinas a píxeles reales al re-subir)
      let origW = 0, origH = 0;
      try {
        const meta = await this.escaneo.metadata(buffer);
        origW = meta.width; origH = meta.height;
      } catch { /* ignora */ }

      // limpia la subida original (ya procesada)
      fs.rmSync(rutaOriginal, { force: true });

      return {
        ok: true,
        id,
        // la imagen procesada se devuelve en base64 para mostrar al instante
        // (la carpeta temporal no está expuesta por nginx)
        preview_b64: `data:image/jpeg;base64,${resultado.data.toString('base64')}`,
        width: resultado.width,
        height: resultado.height,
        img_orig_w: origW,
        img_orig_h: origH,
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
      tipo?: 'factura' | 'comprobante_pago' | 'comprobante_transferencia';
      fecha?: string;
      referencia?: string;
      proveedor?: string;
      total?: number;
    },
  ) {
    if (!body?.id) throw new BadRequestException('Falta el id de previsualización.');
    const tmpFinal = path.join(TMP_DIR, `${body.id}.jpg`);
    if (!fs.existsSync(tmpFinal)) throw new NotFoundException('La previsualización venció. Escanea de nuevo.');

    // Si no viene tipo/datos, pedirlos a la IA sobre la imagen ya escaneada.
    let tipo = body.tipo;
    let fecha = body.fecha || '';
    let proveedor = body.proveedor || '';
    let referencia = body.referencia || '';
    let total = body.total;
    if (!tipo) {
      const buffer = fs.readFileSync(tmpFinal);
      try {
        const leido = await this.ocr.extractText(buffer);
        tipo = (leido.tipo as any) ?? undefined;
        fecha = leido.fecha || fecha;
        proveedor = leido.beneficiario || proveedor;
        referencia = leido.referencia || referencia;
        const t = parseFloat(leido.total as any);
        if (!Number.isNaN(t)) total = t;
      } catch (e) {
        this.logger.warn(`No se pudo leer el documento con IA: ${(e as any)?.message}`);
      }
    }
    if (!tipo) throw new BadRequestException('No se pudo determinar el tipo de documento. Escanea de nuevo o revisa la foto.');

    // Construir el nombre estructurado: AAAAMMDD_REF_PROVEEDOR.jpg
    let aaammdd = String(fecha || '').replace(/[^0-9]/g, '');
    if (aaammdd.length !== 8 && aaammdd.length >= 4) aaammdd = `${aaammdd}0000`.slice(0, 8);
    if (aaammdd.length < 8) aaammdd = '00000000';
    const prov = String(proveedor || '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ._-]/g, '');
    const ref = String(referencia || '').trim().replace(/[^A-Za-z0-9._-]/g, '');
    const nombre = `${aaammdd}_${ref || 'SREF'}_${prov || 'SPROV'}.jpg`;

    // Destino: facturas/AAAA/MM/  |  comprobantes/<tipo>/
    let rutaRel: string;
    const aa = aaammdd.slice(0, 4);
    const mm = aaammdd.slice(4, 6);
    if (tipo === 'factura') {
      rutaRel = path.join('facturas', aa, mm, nombre);
    } else {
      const sub = tipo === 'comprobante_pago' ? 'de_pago' : 'de_transferencia';
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
      if (tipo === 'factura') {
        creado = await this.facturas.create({
          proveedor: proveedor || undefined,
          fecha: fecha || undefined,
          numero_factura: referencia || undefined,
          total_con_impuestos: total ?? undefined,
          archivo,
        });
      } else {
        creado = await this.comprobantes.create({
          beneficiario_emisor: proveedor || undefined,
          fecha: fecha || undefined,
          referencia: referencia || undefined,
          total_con_impuestos: total ?? undefined,
          archivo,
        });
      }
    } catch (e: any) {
      this.logger.warn(`Al guardar el registro falló (quizá duplicado): ${(e?.response?.message || e?.message)}`);
      // El archivo ya está en destino; la duplicidad se reporta sin romper.
    }

    return {
      ok: true,
      tipo,
      archivo,
      archivo_url: `/archivos/${archivo}`,
      id: (creado as any)?.id ?? null,
      detalle: creado ? true : false,
    };
  }
}