import { Injectable, Logger } from '@nestjs/common';
// sharp 0.35+ tiene exports duales (ESM/CJS); `import = require` resuelve al
// .d.mts y no es llamable bajo `module: commonjs`. Declaramos el tipo mínimo
// y usamos `require` directo (CommonJS runtime como exige el tsconfig).
type SharpInstance = {
  grayscale(): SharpInstance;
  threshold(v: number): SharpInstance;
  raw(): { toBuffer(o?: { resolveWithObject?: boolean }): Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }> };
  extract(o: { left: number; top: number; width: number; height: number }): SharpInstance;
  linear(a: number, b: number): SharpInstance;
  sharpen(o?: Record<string, unknown>): SharpInstance;
  resize(o: { width: number }): SharpInstance;
  jpeg(o?: Record<string, unknown>): SharpInstance;
  metadata(): Promise<{ width: number; height: number }>;
  removeAlpha(): SharpInstance;
  toBuffer(o?: { resolveWithObject?: boolean }): Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }>;
};
const sharp = require('sharp') as (input?: Buffer, rawOpts?: Record<string, unknown>) => SharpInstance;

interface EscaneoResult {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Servicio de ESCANEO de documentos (facturas/comprobantes).
 *
 * Pipeline tipo "scanner":
 *   1. Recibe una imagen (foto de la app o de herb).
 *   2. La IA económica (misma del OCR) detecta las 4 esquinas del documento
 *      y aplicamos una transformación de perspectiva (enderezado + recorte).
 *   3. Si la IA no da esquinas válidas, cae en el recorte del mayor blob claro.
 */
@Injectable()
export class EscaneoService {
  private readonly logger = new Logger('Escaneo');
  private readonly key = process.env.OPENROUTER_API_KEY || '';
  private readonly model = process.env.OCR_MODEL || 'google/gemini-3.1-flash-lite';

  private get configurado(): boolean {
    return this.key.trim().length > 20;
  }

  /**
   * Pide a la IA las 4 esquinas del documento en PÍXELES de la imagen reducida
   * (exactamente las dimensiones que se le pasan), orden TL,TR,BR,BL.
   * Devuelve null si no es capaz.
   */
  async detectarEsquinasIA(buffer: Buffer): Promise<number[] | null> {
    if (!this.configurado) return null;
    try {
      const mini = (await sharp(buffer)
        .resize({ width: 1000 })
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true }));
      const mw = mini.info.width, mh = mini.info.height;
      const b64 = mini.data.toString('base64');
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    `La imagen mide EXACTAMENTE ${mw}px de ancho por ${mh}px de alto. ` +
                    'Hay un documento rectangular (factura/comprobante/papel) sobre un fondo. ' +
                    'Halla SUS 4 ESQUINAS EXACTAS (donde empieza y termina el papel, no el texto). ' +
                    `Responde SOLO con JSON válido, sin texto extra:\n` +
                    '{"esquinas": [[tlx,tly],[trx,try],[brx,bry],[blx,bly]]}\n' +
                    'donde cada valor es EN PÍXELES dentro del rango de la imagen ' +
                    `(0 a ${mw} para x, 0 a ${mh} para y). Orden: sup-izq, sup-der, inf-der, inf-izq. ` +
                    'Si no ves un documento claro o las esquinas son inciertas, responde {"esquinas": null}.',
                },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/jpeg;base64,${b64}` },
                },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
      const data = (await res.json()) as any;
      const content = (data?.choices?.[0]?.message?.content as string) || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const raw = jsonMatch ? jsonMatch[0] : '';
      let parsed: any = {};
      try { parsed = JSON.parse(raw); } catch { parsed = {}; }
      const esq = parsed?.esquinas;
      if (!Array.isArray(esq) || esq.length !== 4) return null;
      const pts: number[] = [];
      for (const p of esq) {
        if (!Array.isArray(p) || p.length < 2) return null;
        const x = Number(p[0]), y = Number(p[1]);
        if (Number.isNaN(x) || Number.isNaN(y)) return null;
        pts.push(x, y);
      }
      // Devuelve píxeles en la escala MINI junto con el factor de escala
      // multiplicado por las dimensiones originales.
      const orig = await sharp(buffer).metadata();
      const sx = orig.width / mw, sy = orig.height / mh;
      const px: number[] = [];
      for (let i = 0; i < 8; i++) px.push(i % 2 === 0 ? pts[i] * sx : pts[i] * sy);
      return px; // píxeles de la imagen ORIGINAL
    } catch (e) {
      this.logger.error(`detectarEsquinasIA error: ${(e as any)?.message}`);
      return null;
    }
  }

  /**
   * Detecta el mayor blob claro (papel) como fallback, devolviendo el bbox en
   * píxeles de la imagen ORIGINAL (full res). Útil cuando la IA no responde.
   */
  private async detectarBbox(buffer: Buffer): Promise<{
    minX: number; minY: number; maxX: number; maxY: number; width: number; height: number;
  }> {
    const rawImg = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = rawImg.info;
    const d = new Uint8Array(rawImg.data);
    const c = channels;

    // downsampling 4x para velocidad; píxel "claro" si el papel blanco se
    // distingue de la madera clara con tinte: aeromático (baja saturación) y
    // brillo alto. Luego bbox por PROYECCIÓN (densidad de filas/columnas), que
    // es más robusto que un único blob conexo (este cortaba el papel en fotos
    // donde la madera clara se une al borde del documento).
    const sw = Math.floor(width / 4), sh = Math.floor(height / 4);
    // máscara aeromática
    const mask = new Uint8Array(sw * sh);
    for (let cy = 0; cy < sh; cy++) {
      for (let cx = 0; cx < sw; cx++) {
        const o = (cy * 4 * width + cx * 4) % (d.length - 2);
        const r = d[o], g = d[o + 1], b = d[o + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const lum = (r + g + b) / 3;
        mask[cy * sw + cx] = (mx - mn) < 35 && lum > 145 ? 1 : 0;
      }
    }
    // proyección por filas: cuenta de píxeles aeromáticos por fila (coarse)
    const filas = new Array<number>(sh).fill(0);
    for (let cy = 0; cy < sh; cy++) {
      let cnt = 0;
      for (let cx = 0; cx < sw; cx++) cnt += mask[cy * sw + cx];
      filas[cy] = cnt;
    }
    // rango vertical con densidad significativa (>= 30% del ancho coarse)
    const umbral = Math.floor(sw * 0.3);
    let minY = -1, maxY = -1;
    for (let cy = 0; cy < sh; cy++) {
      if (filas[cy] >= umbral) { if (minY < 0) minY = cy; maxY = cy; }
    }
    if (minY < 0) return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1, width, height };
    // proyección horizontal dentro del rango vertical detectado
    const cols = new Array<number>(sw).fill(0);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = 0; cx < sw; cx++) cols[cx] += mask[cy * sw + cx];
    }
    const v2 = Math.floor((maxY - minY + 1) * 0.5);
    let minX = -1, maxX = -1;
    for (let cx = 0; cx < sw; cx++) {
      if (cols[cx] >= v2) { if (minX < 0) minX = cx; maxX = cx; }
    }
    if (minX < 0) return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1, width, height };
    const M = 6;
    const rMinX = Math.max(0, minX * 4 - M);
    const rMinY = Math.max(0, minY * 4 - M);
    const rMaxX = Math.min(width - 1, maxX * 4 + 4 + M);
    const rMaxY = Math.min(height - 1, maxY * 4 + 4 + M);
    return { minX: rMinX, minY: rMinY, maxX: rMaxX, maxY: rMaxY, width, height };
  }

  /**
   * Aplica la transformación de perspectiva (homografía) para enderezar las 4
   * esquinas a un rectángulo. `esquinas` deben venir en coordenadas de la
   * imagen ORIGINAL (píxeles).
   */
  private async warp(buffer: Buffer, esquinasPx: number[]): Promise<EscaneoResult> {
    const [tlx, tly, trx, tryx, brx, bry, blx, bly] = esquinasPx;
    const dist = (x1: number, y1: number, x2: number, y2: number) =>
      Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const W = Math.round((dist(tlx, tly, trx, tryx) + dist(blx, bly, brx, bry)) / 2);
    const H = Math.round((dist(tlx, tly, blx, bly) + dist(trx, tryx, brx, bry)) / 2);
    const w = Math.max(40, W), h = Math.max(40, H);

    const rawImg = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: iw, height: ih, channels: c } = rawImg.info;
    const src = [tlx, tly, trx, tryx, brx, bry, blx, bly];
    const dst = [0, 0, w, 0, w, h, 0, h];

    const PersT = require('perspective-transform');
    const Ctor = (PersT?.default || PersT) as (...a: unknown[]) => { transform?: (x: number, y: number) => number[] };
    let t: any;
    try {
      t = Ctor(src, dst);
    } catch {
      // API alternativa: PerspT(puntos) puede esperar una estructura distinta.
      t = Ctor?.[0] ? Ctor[0](src, dst) : Ctor(src, dst);
    }
    if (!t || typeof t.transform !== 'function') {
      throw new Error('perspective-transform no expuso transform()');
    }

    const data = new Uint8Array(rawImg.data);
    const out = new Uint8Array(w * h * c);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = t.transform(x, y);
        const px = Math.round(s[0]), py = Math.round(s[1]);
        if (px >= 0 && py >= 0 && px < iw && py < ih) {
          const si = (py * iw + px) * c, di = (y * w + x) * c;
          for (let k = 0; k < c; k++) out[di + k] = data[si + k];
        }
      }
    }
    const finalImg = await sharp(Buffer.from(out), { raw: { width: w, height: h, channels: c } })
      .linear(1.5, -30)
      .sharpen({ sigma: 1.2 })
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true });
    return { data: finalImg.data, width: finalImg.info.width, height: finalImg.info.height };
  }

  /**
   * Procesa la imagen de escaneo y devuelve el documento enderezado/recortado.
   * - Si vienen `esquinas` (manuales/de la app): warp directo en píxeles.
   * - Si no: pide las esquinas a la IA (en píxeles exactos de la original) y
   *   aplica la transformación de perspectiva (enderezado del ángulo).
   * - Si la IA no da esquinas o el warp falla: recorte por preferencia segura.
   */
  async procesar(buffer: Buffer, esquinas?: number[]): Promise<EscaneoResult> {
    // 1) Esquinas explícitas (Nivel 2 / manual): warp directo en píxeles.
    //    Es el modo de ENDEREZADO FIABLE: el usuario ajusta las 4 esquinas y
    //    el warp las usa tal cual (CamScanner-style). Probado: con esquinas
    //    correctas da un recorte enderezado limpio.
    if (esquinas && esquinas.length === 8) {
      try { return await this.warp(buffer, esquinas); }
      catch (e) { this.logger.warn(`warp manual falló, uso bbox: ${(e as any)?.message}`); }
    }

    // 2) Recorte del mayor blob claro + realce (seguro, no corta texto).
    //    NOTA: el enderezado AUTOMÁTICO por IA (detectarEsquinasIA) está
    //    disponible pero NO se auto-invoca: en las fotos reales probadas
    //    devolvía esquinas que hacen que el warp salga negro/recortado. Se
    //    re-usa solo cuando el usuario entrega esquinas manuales (Nivel 2).
    const { minX, minY, maxX, maxY } = await this.detectarBbox(buffer);
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const exOut = (await sharp(buffer)
      .extract({ left: minX, top: minY, width: w, height: h })
      .linear(1.6, -40)
      .sharpen({ sigma: 1.4, m1: 1, m2: 2, x1: 25, y2: 6, y3: 4 })
      .resize({ width: Math.min(1500, w) })
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true }));
    return { data: exOut.data, width: exOut.info.width, height: exOut.info.height };
  }
}