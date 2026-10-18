import {
  BadRequestException,
  Controller,
  Post,
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
  constructor(private readonly ocr: OcrService) {
    fs.mkdirSync(IMAGENES_DIR, { recursive: true });
    for (const s of Object.values(SUB)) {
      fs.mkdirSync(path.join(IMAGENES_DIR, s), { recursive: true });
    }
  }

  /**
   * Sube una imagen de factura/comprobante, la guarda, y con el modelo de
   * visión IA detecta el tipo de documento automáticamente y lee sus datos.
   * La imagen se mueve a la subcarpeta según el tipo (sin que la interfaz
   * tenga que preguntar). Devuelve el texto y los campos para pre-rellenar.
   */
  @Post('subir')
  @UseInterceptors(
    FileInterceptor('archivo', {
      storage: diskStorage({
        // Se guarda primero en la raíz; al detectar el tipo se mueve a su carpeta.
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
    const resultado = await this.ocr.extractText(buffer);

    // Mover a la subcarpeta según el tipo detectado (si hay).
    const carpeta = subcarpeta(resultado.tipo ?? undefined);
    let rutaFinal = rutaOriginal;
    if (carpeta) {
      const destino = path.join(IMAGENES_DIR, carpeta, file.filename);
      fs.renameSync(rutaOriginal, destino);
      rutaFinal = destino;
    }

    return {
      ok: true,
      tipo: resultado.tipo,
      texto: resultado.texto,
      beneficiario: resultado.beneficiario,
      fecha: resultado.fecha,
      total: resultado.total,
      referencia: resultado.referencia,
      archivo: file.filename,
      archivo_url: `/archivos/${carpeta ? carpeta + '/' : ''}${file.filename}`,
    };
  }
}