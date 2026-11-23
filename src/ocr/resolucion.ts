/**
 * Comparación de "resolución" entre dos archivos del mismo documento
 * (factura/comprobante) cuando llega un duplicado a /api/ocr/subir.
 *
 * Sin pdf-parse/pdfjs en runtime (node_modules gobernado por CI), el PDF se
 * evalúa heurísticamente: MediaBox de la 1ª página (tamaño en puntos) y
 * presencia de fuentes de texto (capa de texto) en los primeros KB.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface Resolucion {
  tipo: 'image' | 'pdf' | 'other';
  /** píxeles efectivos (imagen: w*h reales; pdf: pageW*pageH * (96/72)^2 para comparar). */
  pixels: number;
  /** tamaño en bytes del archivo. */
  sizeBytes: number;
  /** pdf: ¿tiene capa de texto? (true si declara /Font). */
  tieneTexto: boolean;
}

/** Umbral mínimo ABSOLUTO de píxeles: solo para captar tamaños absurdos
 *  (p. ej. iconos 40×40). NO es el criterio de calidad: una imagen nítida de
 *  cualquier proporción legítima (boucher 245×1280 = 313.600 px) debe pasar.
 *  El criterio real de legibilidad es la varianza del Laplaciano (calcularBlur). */
export const MIN_PIXELS_ABSURDOS = 10000; // 100×100

/** Umbral de nitidez (varianza del Laplaciano normalizada a 800px).
 *  Calibrado 2026-11-22 con lote real IRCC en :test:
 *    nítidas: original 415 · 80% 157 · 50% 38  → pasan
 *    ilegibles: 35% 9.5 · 25% 2.4 · borrosa 0.5 → rechazan
 *  MIN_BLUR=20 deja margen 2× entre legibles (≥38) e ilegibles (≤9.5). */
export const MIN_BLUR = 20;

/** ── MIX CALIDAD-BLUR (REPORTE-CAPA1-CALIDAD-BLUR, withoutEnlargement) ──
 *  Estrategia de dos niveles según el tamaño, para abarcar el máximo de casos:
 *  - Imagen GRANDE (>= MIN_PIXELS_PEQUENA): basta blur NATIVO (sin estirar)
 *    ≥ MIN_BLUR. Cubre bouchers largos (245×1280=313.600px, nativo 1057) y
 *    fotos normales (50%=230.400px, nativo 588).
 *  - Imagen PEQUEÑA (< MIN_PIXELS_PEQUENA): exige blur NATIVO mucho mayor
 *    (≥ MIN_BLUR_PEQUENA) para distinguir capturas nítidas legítimas de texto
 *    grande (200×200 nítida → nativo 978) de reducciones ilegibles
 *    (25%→404, 35%→519) que alucinan datos. Sin estirar: estirar castigaba a
 *    la nítida pequeña; sin estirar, la reducción ilegible queda expuesta.
 *  Calibrado con lote real en :test (2026-11-23). */
export const MIN_PIXELS_PEQUENA = 150000; // ~390×390: por debajo → exigir nitidez fina
export const MIN_BLUR_PEQUENA = 650;      // 978 (200×200 nítida) vs 519 (35% ilegible) vs 404 (25%)

export interface DecisionCalidad {
  rechazar: boolean;
  motivo: string;
}

/**
 * Decisión pura de la Capa 1 (REPORTE-CAPA1-CALIDAD-BLUR, mix):
 * - Tamaño absurdo (< MIN_PIXELS_ABSURDOS) → rechazar.
 * - Grande (>= MIN_PIXELS_PEQUENA): blur nativo >= MIN_BLUR.
 * - Pequeña (< MIN_PIXELS_PEQUENA): blur nativo >= MIN_BLUR_PEQUENA
 *   (una reducción ilegible se ve "nítida" a su escala pero no es legible).
 * Separada del controller para poder testearla en la suite e2e sin IA.
 */
export function decidirCalidad(
  dims: DimensionesImg,
  blur: number,
): DecisionCalidad {
  const tamAbsurdo = dims.pixels > 0 && dims.pixels < MIN_PIXELS_ABSURDOS;
  const pequena = dims.pixels > 0 && dims.pixels < MIN_PIXELS_PEQUENA;
  const umbral = pequena ? MIN_BLUR_PEQUENA : MIN_BLUR;
  const borrosa = blur >= 0 && blur < umbral;
  if (tamAbsurdo) return { rechazar: true, motivo: 'tamaño absurdo' };
  if (borrosa)
    return {
      rechazar: true,
      motivo: pequena ? 'pequeña insuficientemente nítida' : 'borrosa',
    };
  return { rechazar: false, motivo: 'aceptada' };
}

/**
 * Varianza del Laplaciano (blur score) de una imagen vía sharp.
 * - Nítida  → bordes marcados → varianza ALTA.
 * - Borrosa → bordes suaves → varianza BAJA (tiende a 0).
 *
 * `withEnlargement` (false por defecto) controla la normalización de escala:
 * - false (nativo): reduce solo las mayores de 800px; las pequeñas se miden en
 *   su nitidez real (no se castigan documentos legítimos pequeños: bouchers
 *   245×1280, capturas nítidas de proporciones raras).
 * - true (normalizado): estira todas a 800px; las imágenes pequeñas se suavizan
 *   al estirarse y su score cae → detecta reducciones ilegibles (180×320 da 2.4,
 *   aunque en nativo dé 404). Se usa como criterio adicional en imágenes pequeñas.
 * Devuelve -1 si no se puede medir (el caller no rechaza por blur en ese caso).
 */
export async function calcularBlur(
  ruta: string,
  withEnlargement = false,
): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require('sharp');
    const { data } = await sharp(ruta)
      .resize({ width: 800, withoutEnlargement: !withEnlargement })
      .grayscale()
      .convolve({
        width: 3,
        height: 3,
        kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], // Laplaciano
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const n = data.length;
    if (!n) return -1;
    let media = 0;
    for (let i = 0; i < n; i++) media += data[i];
    media /= n;
    let varianza = 0;
    for (let i = 0; i < n; i++) {
      const d = data[i] - media;
      varianza += d * d;
    }
    return varianza / n;
  } catch {
    return -1;
  }
}

export interface DimensionesImg {
  width: number;
  height: number;
  pixels: number;
}

/**
 * Mide ancho/alto/píxeles reales de una imagen vía sharp.
 * Devuelve todos 0 si no es imagen legible (el caller decide con el umbral).
 */
export async function medirImagen(ruta: string): Promise<DimensionesImg> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require('sharp');
    const meta = await sharp(ruta).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    return { width, height, pixels: width * height };
  } catch {
    return { width: 0, height: 0, pixels: 0 };
  }
}

/** Lee hasta N bytes del inicio del archivo. */
function leerCabeza(ruta: string, max = 65536): Buffer {
  try {
    const fd = fs.openSync(ruta, 'r');
    try {
      const buf = Buffer.alloc(max);
      const bytes = fs.readSync(fd, buf, { position: 0 });
      return buf.subarray(0, bytes);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return Buffer.alloc(0);
  }
}

function esPdf(buf: Buffer): boolean {
  return buf.slice(0, 5).toString('latin1') === '%PDF-';
}

/** Detecta la capa de texto de un PDF: presencia de diccionarios /Font. */
function pdfTieneTexto(buf: Buffer): boolean {
  // Un PDF escaneado (imagen pura) no declara fuentes de texto; uno con capa
  // de texto sí. Heurística barata pero suficiente para el caso duplicado.
  return /\/Type\s*\/Font\b/.test(buf.toString('latin1'));
}

/** pageW/pageH en puntos de la 1ª página (MediaBox del índice de páginas). */
function pdfPage(buf: Buffer): { pageW: number; pageH: number } {
  const m = buf
    .toString('latin1')
    .match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  if (!m) return { pageW: 0, pageH: 0 };
  const x1 = parseFloat(m[1]);
  const y1 = parseFloat(m[2]);
  const x2 = parseFloat(m[3]);
  const y2 = parseFloat(m[4]);
  let w = x2 - x1;
  let h = y2 - y1;
  if (!(w > 0) || !(h > 0)) {
    w = x2;
    h = y2;
  }
  return { pageW: w, pageH: h };
}

/**
 * Mide la definición de un archivo en el volumen de imágenes.
 * `sharp` mide imágenes reales; los PDF se triangulan (sin parser instalado).
 */
export async function resolverArchivo(ruta: string): Promise<Resolucion> {
  const sizeBytes = fs.existsSync(ruta) ? fs.statSync(ruta).size : 0;
  const cabeza = leerCabeza(ruta);

  if (esPdf(cabeza)) {
    const { pageW, pageH } = pdfPage(cabeza);
    // puntos → px a 96dpi (96/72) para poder comparar con píxeles de imagen.
    const pixels = Math.round(pageW * pageH * (96 / 72) * (96 / 72));
    return {
      tipo: 'pdf',
      pixels,
      sizeBytes,
      tieneTexto: pdfTieneTexto(cabeza),
    };
  }

  // Intento de imagen vía sharp (más fiable; si falla, solo bytes).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require('sharp');
    const meta = await sharp(ruta).metadata();
    const pixels = (meta.width || 0) * (meta.height || 0);
    return { tipo: 'image', pixels, sizeBytes, tieneTexto: false };
  } catch {
    return { tipo: 'other', pixels: 0, sizeBytes, tieneTexto: false };
  }
}

/** Motivo legible de la comparación (trazabilidad en la respuesta de la API). */
export function motivoMejor(r: Resolucion): string {
  if (r.pixels > 0) return `mayor definición (${r.pixels.toLocaleString('es-CO')} px)`;
  return `mayor tamaño (${r.sizeBytes} bytes)`;
}

/**
 * ¿La resolución `a` es estrictamente mejor que `b`?
 * - PDF con capa de texto gana a PDF escaneado o imagen del mismo doc.
 * - Igual tipo: mayor pixels; empate cercano → mayor bytes.
 * - image vs pdf sin texto: se comparan los pixels (el pdf escala a 96dpi).
 */
export function esMejor(a: Resolucion, b: Resolucion): boolean {
  // Capa de texto manda cuando existe en un PDF.
  const aTexto = a.tipo === 'pdf' && a.tieneTexto;
  const bTexto = b.tipo === 'pdf' && b.tieneTexto;
  if (aTexto !== bTexto) return aTexto;

  const umbral = 0.985; // "casi iguales" (±1.5%)
  const pxA = a.pixels || 0;
  const pxB = b.pixels || 0;
  if (pxA > 0 && pxB > 0) {
    if (pxA !== pxB) {
      if (pxA > pxB * umbral && pxA < pxB / umbral) {
        return a.sizeBytes > b.sizeBytes; // casi iguales → el mayor en bytes
      }
      return pxA > pxB;
    }
    return a.sizeBytes > b.sizeBytes;
  }
  // Sin métrica real: mayor tamaño.
  return a.sizeBytes > b.sizeBytes;
}
