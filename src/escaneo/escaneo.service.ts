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

  /** Normaliza las coordenadas que devuelve la IA a rango 0-1 (autodetecta escala). */
  private normalizarEsquinas(pts: number[]): number[] | null {
    const maxx = Math.max(pts[0], pts[2], pts[4], pts[6]);
    const maxy = Math.max(pts[1], pts[3], pts[5], pts[7]);
    const maxA = Math.max(maxx, maxy);
    if (maxA <= 1.5) return pts;            // ya en 0-1
    if (maxA <= 1000) {                     // escala 0-1000 (permil)
      for (let i = 0; i < 8; i++) pts[i] = pts[i] / 1000;
      return pts;
    }
    for (let i = 0; i < 8; i++) pts[i] = pts[i] / maxA; // escala arbitraria
    return pts;
  }

  /**
   * Pide a la IA las 4 esquinas del documento (coordenadas normalizadas 0-1,
   * orden TL,TR,BR,BL). Devuelve null si no es capaz.
   */
  async detectarEsquinasIA(buffer: Buffer): Promise<number[] | null> {
    if (!this.configurado) return null;
    try {
      const mini = (await sharp(buffer)
        .resize({ width: Math.min(1100, 1000) })
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true }));
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
                    'En la imagen hay un documento rectangular (factura/comprobante/' +
                    'papel) sobre un fondo. Detecta sus 4 esquinas y responde SOLO con ' +
                    'JSON válido, sin texto extra, con esta forma exacta:\n' +
                    '{"esquinas": [[tlx,tly],[trx,try],[brx,bry],[blx,bly]]}\n' +
                    'donde cada punto está en COORDENADAS NORMALIZADAS entre 0 y 1 ' +
                    '(x/width, y/height de la imagen). Las esquinas en orden: ' +
                    'sup-izq (tl), sup-der (tr), inf-der (br), inf-izq (bl). ' +
                    'Si no ves un documento claro, responde {"esquinas": null}.',
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
      return pts; // normalizadas 0-1
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
    // brillo alto.
    const sw = Math.floor(width / 4), sh = Math.floor(height / 4);
    const bin = new Uint8Array(sw * sh);
    for (let cy = 0; cy < sh; cy++) {
      for (let cx = 0; cx < sw; cx++) {
        const o = (cy * 4 * width + cx * 4) % (d.length - 2);
        const r = d[o], g = d[o + 1], b = d[o + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const lum = (r + g + b) / 3;
        bin[cy * sw + cx] = (mx - mn) < 35 && lum > 145 ? 1 : 0;
      }
    }

    // mayor componente conexo
    const visited = new Uint8Array(sw * sh);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let bestSize = 0;
    let bestBox: { m1: number; m2: number; m3: number; m4: number } | null = null;
    for (let y0 = 0; y0 < sh; y0++) {
      for (let x0 = 0; x0 < sw; x0++) {
        if (bin[y0 * sw + x0] === 1 && !visited[y0 * sw + x0]) {
          const st = [[x0, y0]]; visited[y0 * sw + x0] = 1;
          let size = 0; let m1 = 1e9, m2 = -1, m3 = 1e9, m4 = -1;
          while (st.length) {
            const cell = st.pop()!; const [x, y] = cell; size++;
            if (x < m1) m1 = x; if (x > m2) m2 = x;
            if (y < m3) m3 = y; if (y > m4) m4 = y;
            for (const [dx, dy] of dirs) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && ny >= 0 && nx < sw && ny < sh && bin[ny * sw + nx] === 1 && !visited[ny * sw + nx]) {
                visited[ny * sw + nx] = 1; st.push([nx, ny]);
              }
            }
          }
          if (size > bestSize) { bestSize = size; bestBox = { m1, m2, m3, m4 }; }
        }
      }
    }
    if (!bestBox) return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1, width, height };
    const M = 6;
    const minX = Math.max(0, bestBox.m1 * 4 - M);
    const minY = Math.max(0, bestBox.m3 * 4 - M);
    const maxX = Math.min(width - 1, bestBox.m2 * 4 + 1 + M);
    const maxY = Math.min(height - 1, bestBox.m4 * 4 + 1 + M);
    return { minX, minY, maxX, maxY, width, height };
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
   * - Si no: recorte del mayor blob claro + realce (seguro, no corta texto).
   *
   * NOTA: el enderezado por IA (detectarEsquinasIA) está disponible pero NO se
   * auto-invoca aquí: en la única foto real probada las esquinas de la IA
   * recortaban texto del documento. Se activará cuando se calibre con una foto
   * en ángulo (o se use el warp manual del Nivel 2 con esquinas del usuario).
   */
  async procesar(buffer: Buffer, esquinas?: number[]): Promise<EscaneoResult> {
    // 1) Esquinas explícitas (Nivel 2 / manual): warp directo en píxeles
    if (esquinas && esquinas.length === 8) {
      try { return await this.warp(buffer, esquinas); }
      catch (e) { this.logger.warn(`warp manual falló, uso bbox: ${(e as any)?.message}`); }
    }

    // 2) Recorte del mayor blob claro + realce (seguro, no corta texto)
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