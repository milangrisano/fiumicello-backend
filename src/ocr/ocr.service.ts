import { Injectable } from '@nestjs/common';
import { createWorker, PSM, Worker } from 'tesseract.js';

/**
 * OCR de imágenes (facturas/comprobantes).
 *
 * Usa Tesseract.js (open-source, offline, sin claves). Corre en el servidor
 * (Node) y soporta latín/español, suficiente para leer total, fecha,
 * proveedor y referencia de una foto de factura/comprobante.
 */
@Injectable()
export class OcrService {
  private workerPromise: Promise<Worker> | null = null;

  /** Lazy worker de Tesseract (iniciamos una sola vez, idiomas spa+eng). */
  private async getWorker(): Promise<Worker> {
    if (!this.workerPromise) {
      this.workerPromise = (async () => {
        const worker = await createWorker(['spa', 'eng']);
        await worker.setParameters({
          preserve_interword_spaces: '1',
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK, // bloque uniforme de texto
        });
        return worker;
      })();
    }
    return this.workerPromise;
  }

  /**
   * Extrae el texto de una imagen. `imageBuffer` es la foto (JPEG/PNG).
   * Devuelve el texto crudo y la ruta de la imagen guardada. El frontend usa
   * el texto para pre-rellenar la factura o comprobante; la persona revisa
   * y corrige antes de guardar.
   */
  async extractText(imageBuffer: Buffer): Promise<{ texto: string }> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(imageBuffer);
    return { texto: (data.text || '').trim() };
  }
}