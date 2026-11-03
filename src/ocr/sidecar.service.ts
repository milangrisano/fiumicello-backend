import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Escribe el sidecar JSON de una imagen/PDF recién guardada por el OCR.
 *
 * Convención del proyecto (ver INFRAESTRUCTURA.md §10.1): cada documento
 * `X.jpg` / `X.pdf` vive al lado de un sidecar `X.json` con los datos que se
 * extrajeron/confirmaron del documento. La ruta del sidecar se deriva de la
 * del archivo: se le quita la extensión real (`.jpg`/`.jpeg`/`.png`/`.pdf`)
 * y se sustituye por `.json`, en la MISMA carpeta.
 */
@Injectable()
export class SidecarService {
  private readonly logger = new Logger('Sidecar');

  /** Devuelve la ruta del sidecar (`.json`) para una ruta de archivo relativa. */
  static sidecarPath(archivoRelativo: string): string {
    return archivoRelativo.replace(/\.[a-zA-Z0-9]+$/, '.json');
  }

  /**
   * Escribe (o sobrescribe) el sidecar JSON del documento.
   * @param imgenesDir  raíz de imágenes (IMAGENES_DIR)
   * @param archivo     ruta relativa del documento (p. ej. `facturas/2026/10/x.jpg`)
   * @param datos       objeto de datos extraídos/confirmados a guardar
   */
  write(
    imgenesDir: string,
    archivo: string,
    datos: Record<string, unknown>,
  ): string | null {
    try {
      const dir = path.dirname(path.join(imgenesDir, archivo));
      fs.mkdirSync(dir, { recursive: true });
      const sidecar = path.join(imgenesDir, SidecarService.sidecarPath(archivo));
      fs.writeFileSync(sidecar, JSON.stringify(datos, null, 2), 'utf8');
      return sidecar;
    } catch (e) {
      this.logger.error('No se pudo escribir el sidecar', e as any);
      return null;
    }
  }
}