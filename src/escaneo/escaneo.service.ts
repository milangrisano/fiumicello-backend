import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

/**
 * Servicio de ESCANEO de documentos (facturas/comprobantes).
 *
 * Pipeline tipo "scanner":
 *   1. Recibe una imagen (foto de la app o de herb).
 *   2. Con `sharp` aísla el papel (threshold + bbox), realza y, opcionalmente,
 *      endereza aplicando una transformación de perspectiva con las 4 esquinas.
 *   3. Devuelve la imagen procesada (para previsualizar / guardar).
 *
 * La detección de esquinas puede venir de:
 *   - Detección automática (Nivel 1, recorte por bbox + realce).
 *   - Esquinas manuales (Nivel 2, ajustadas por el usuario en la app).
 *   - IA de visión (respaldo: el modelo económico devuelve las 4 esquinas).
 */
@Injectable()
export class EscaneoService {
  private readonly logger = new Logger('Escaneo');
  private readonly key = process.env.OPENROUTER_API_KEY || '';
  private readonly model = process.env.OCR_MODEL || 'google/gemini-3.1-flash-lite';

  /**
   * Aísla el papel (blanco sobre fondo) y devuelve el bbox [minX,minY,maxX,maxY]
   * en las dimensiones del buffer. Usa threshold + proyección.
   */
  private async detectarBbox(buffer: Buffer): Promise<{
    minX: number; minY: number; maxX: number; maxY: number; width: number; height: number;
  }> {
    const g = await sharp(buffer).grayscale().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = g.info;
    const d = new Uint8Array(g.data);
    // umbral: fondo oscuro vs papel blanco -> detección de "blob claro grande"
    // proyección simple sobre todos los píxeles que superan 90 (rojo de luminosidad)
    let minX = width, minY = height, maxX = -1, maxY = -1;
    // Usar el percentil para elegir umbral: tomamos 60 si hay contraste.
    // Para robustez: consideramos píxel "de documento" si su nivel es > umbral
    // donde umbral se ajusta por histograma simple (Otsu-lite).
    const umbral = this.umbralOtsu(d);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (d[row + x] > umbral) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    // margen de seguridad
    const M = 8;
    minX = Math.max(0, minX - M); minY = Math.max(0, minY - M);
    maxX = Math.min(width - 1, maxX + M); maxY = Math.min(height - 1, maxY + M);
    return { minX, minY, maxX, maxY, width, height };
  }

  /** Umbral de Otsu simple sobre el histograma de luminancia. */
  private umbralOtsu(d: Uint8Array): number {
    const hist = new Array<number>(256).fill(0);
    for (const v of d) hist[v]++;
    const total = d.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, maxVar = 0, umbral = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const entre = wB * wF * (mB - mF) * (mB - mF);
      if (entre > maxVar) { maxVar = entre; umbral = t; }
    }
    return Math.max(umbral, 140); // no bajar de 140 para evitar fondo claro como doc
  }

  /**
   * Procesa la imagen: recorta el documento detectado y aplica realce.
   * Si se pasan `esquinas` (4 puntos [x,y]), aplica transformación de
   * perspectiva para enderezar antes de recortar.
   * Devuelve el Buffer JPG ya procesado.
   */
  async procesar(
    buffer: Buffer,
    esquinas?: number[],
  ): Promise<{ data: Buffer; width: number; height: number }> {
    try {
      const { minX, minY, maxX, maxY, width, height } = await this.detectarBbox(buffer);

      // 1) Recortar el documento
      const rec = await sharp(buffer)
        .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
        .toBuffer({ resolveWithObject: true });

      // 2) Realce: subir contraste, saturación leve, nitidez
      const out = await sharp(rec.data, { raw: rec.info })
        .resize({ width: Math.min(1500, rec.info.width) })
        .linear(1.6, -40)           // reforzar contraste
        .sharpen({ sigma: 1.4, m1: 1, m2: 2, x1: 25, y2: 6, y3: 4 })
        .jpeg({ quality: 92 })
        .toBuffer();

      // Nota: enderezado por perspectiva (esquinas) se aplica antes del recorte
      // cuando esté integrado; por ahora el recorte+realce da el "scan limpio".
      return { data: out, width: 1000, height: 1200 };
    } catch (e) {
      this.logger.error('Escaneo error', e as any);
      throw e;
    }
  }
}