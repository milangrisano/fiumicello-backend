import {
  BadRequestException,
  Controller,
  Logger,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { OcrService } from './ocr.service';
import { FacturasService } from '../facturas/facturas.service';
import { ComprobantesService } from '../comprobantes/comprobantes.service';

/**
 * Raíz de imágenes servida por nginx como `/archivos/...`. Configurable por
 * env (IMAGENES_DIR). Se replica igual en Lenovo (producción).
 *
 * Estructura (mapea a la de Lenovo):
 *   <IMAGENES_DIR>/facturas/
 *   <IMAGENES_DIR>/comprobantes/de_pago/
 *   <IMAGENES_DIR>/comprobantes/de_transferencia/
 */
const IMAGENES_DIR =
  process.env.IMAGENES_DIR || path.resolve(process.cwd(), 'archivos');

/** Subcarpeta destino según el tipo detectado por el OCR. */
const SUB = {
  factura: 'facturas',
  comprobante_pago: 'comprobantes/de_pago',
  comprobante_transferencia: 'comprobantes/de_transferencia',
} as const;

function subcarpeta(tipo?: string): string {
  return (tipo && SUB[tipo as keyof typeof SUB]) || '';
}

@Controller('ocr')
export class OcrController {
  private readonly logger = new Logger('Ocr');

  constructor(
    private readonly ocr: OcrService,
    private readonly facturas: FacturasService,
    private readonly comprobantes: ComprobantesService,
  ) {
    fs.mkdirSync(IMAGENES_DIR, { recursive: true });
    for (const s of Object.values(SUB)) {
      fs.mkdirSync(path.join(IMAGENES_DIR, s), { recursive: true });
    }
  }

  /**
   * Toma una foto de factura/comprobante, la guarda, y con visión IA detecta
   * el tipo y los datos. Luego CREA automáticamente el registro (factura o
   * comprobante) con esos datos, sin que la interfaz tenga que preguntar nada.
   * Devuelve el registro creado (o si ya existía, para avisarlo).
   */
  @Post('subir')
  @UseInterceptors(
    FileInterceptor('archivo', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, IMAGENES_DIR),
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^A-Za-z0-9._-]/g, '_');
          cb(null, `${Date.now()}_${safe}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 }, // máx 20 MB
    }),
  )
  async subir(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo.');
    const rutaOriginal = file.path;
    const buffer = fs.readFileSync(rutaOriginal);

    let resultado: Awaited<ReturnType<OcrService['extractText']>>;
    try {
      resultado = await this.ocr.extractText(buffer);
    } catch (e) {
      fs.rmSync(rutaOriginal, { force: true });
      this.logger.error('OCR error', e as any);
      return {
        ok: false,
        error: 'No se pudo leer la imagen (visión IA). Trata de nuevo.',
      };
    }

    // Mover la imagen a su subcarpeta según el tipo detectado.
    const carpeta = subcarpeta(resultado.tipo ?? undefined);
    if (carpeta) {
      const destino = path.join(IMAGENES_DIR, carpeta, file.filename);
      fs.renameSync(rutaOriginal, destino);
    }
    const archivo_url = `/archivos/${carpeta ? carpeta + '/' : ''}${file.filename}`;

    // Crear el registro automáticamente con los datos leídos.
    let creado: any = null;
    let yaExistia = false;
    let mensaje = '';
    try {
      if (resultado.tipo === 'factura') {
        creado = await this.facturas.create({
          proveedor: resultado.beneficiario || undefined,
          fecha: resultado.fecha || undefined,
          numero_factura: resultado.referencia || undefined,
          total_con_impuestos: parseFloat(resultado.total) || undefined,
          archivo: file.filename,
        });
        mensaje = 'Factura creada';
      } else if (
        resultado.tipo === 'comprobante_pago' ||
        resultado.tipo === 'comprobante_transferencia'
      ) {
        creado = await this.comprobantes.create({
          beneficiario_emisor: resultado.beneficiario || undefined,
          fecha: resultado.fecha || undefined,
          referencia: resultado.referencia || undefined,
          total_con_impuestos: parseFloat(resultado.total) || undefined,
          archivo: file.filename,
        });
        mensaje = 'Comprobante creado';
      } else {
        mensaje = 'Documento guardado, pero no se pudo determinar el tipo';
      }
    } catch (e: any) {
      // Duplicado (o validación): no romper el flujo.
      yaExistia = true;
      mensaje =
        (e?.response?.message as string) ||
        e?.message ||
        'No se pudo crear';
      const id = e?.response?.message?.match(/id (\d+)/i)?.[1];
      creado = id ? { id: Number(id) } : null;
    }

    return {
      ok: true,
      tipo: resultado.tipo,
      creado: !yaExistia && creado != null,
      ya_existia: yaExistia,
      mensaje,
      id: (creado as any)?.id ?? null,
      archivo: file.filename,
      archivo_url,
      beneficiario: resultado.beneficiario,
      fecha: resultado.fecha,
      total: resultado.total,
      referencia: resultado.referencia,
      texto: resultado.texto,
    };
  }
}