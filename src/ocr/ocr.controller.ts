import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { OcrService } from './ocr.service';

/**
 * Raíz de imágenes servida por nginx como `/archivos/...`. Configurable por
 * env (IMAGENES_DIR). Se replica igual en Lenovo (producción): el backend de
 * Lenovo escribe directamente en la carpeta local montada como volumen (sin
 * SMB). SMB solo lo usa herb para guardar facturas/comprobantes recibidos por
 * ese medio.
 *
 * Estructura (mapea a la de Lenovo):
 *   <IMAGENES_DIR>/facturas/
 *   <IMAGENES_DIR>/comprobantes/de_pago/
 *   <IMAGENES_DIR>/comprobantes/de_transferencia/
 */
const IMAGENES_DIR =
  process.env.IMAGENES_DIR || path.resolve(process.cwd(), 'archivos');

/** Subcarpeta destino según el tipo que manda el frontend. */
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
  constructor(private readonly ocr: OcrService) {
    fs.mkdirSync(IMAGENES_DIR, { recursive: true });
    for (const s of Object.values(SUB)) {
      fs.mkdirSync(path.join(IMAGENES_DIR, s), { recursive: true });
    }
  }

  /**
   * Sube una imagen de factura/comprobante, la guarda en la subcarpeta según
   * `tipo` (factura | comprobante_pago | comprobante_transferencia), y lee su
   * texto con OCR. Devuelve la ruta web y el texto extraído para pre-rellenar
   * el formulario.
   */
  @Post('subir')
  @UseInterceptors(
    FileInterceptor('archivo', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const tipo = (_req.query?.tipo as string) || '';
          cb(null, path.join(IMAGENES_DIR, subcarpeta(tipo)));
        },
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^A-Za-z0-9._-]/g, '_');
          cb(null, `${Date.now()}_${safe}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 }, // máx 20 MB
    }),
  )
  async subir(
    @UploadedFile() file?: Express.Multer.File,
    @Query('tipo') tipo?: string,
  ) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo.');
    const buffer = fs.readFileSync(file.path);
    const { texto } = await this.ocr.extractText(buffer);
    const carpeta = subcarpeta(tipo);
    return {
      ok: true,
      tipo: tipo || null,
      archivo: file.filename,
      archivo_url: `/archivos/${carpeta ? carpeta + '/' : ''}${file.filename}`,
      texto,
    };
  }
}