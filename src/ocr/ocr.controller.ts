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
 * Carpeta servida por nginx como `/archivos/...`. Configurable por env
 * (IMAGENES_DIR). En producción (Lenovo) apunta a la carpeta montada en el
 * contenedor frontend (nginx) o a un bind-mount compartido.
 */
const IMAGENES_DIR =
  process.env.IMAGENES_DIR || path.resolve(process.cwd(), 'archivos');

@Controller('ocr')
export class OcrController {
  constructor(private readonly ocr: OcrService) {
    fs.mkdirSync(IMAGENES_DIR, { recursive: true });
  }

  /**
   * Sube una imagen de factura/comprobante, la guarda en /archivos y lee su
   * texto con OCR. Devuelve la ruta web y el texto extraído para pre-rellenar
   * el formulario.
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
    const buffer = fs.readFileSync(file.path);
    const { texto } = await this.ocr.extractText(buffer);
    return {
      ok: true,
      archivo: file.filename,
      archivo_url: `/archivos/${file.filename}`,
      texto,
    };
  }
}