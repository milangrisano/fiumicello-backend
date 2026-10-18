import { Injectable } from '@nestjs/common';

/**
 * OCR de imágenes (facturas/comprobantes) por VISIÓN IA.
 *
 * Usa el mismo motor que herb: un modelo de visión (OpenRouter, por defecto
 * google/gemini-3.1-flash-image) que lee el documento como un escáner y
 * devuelve los datos estructurados. Esto da una calidad muy superior al OCR
 * clásico (Tesseract), suficiente para leer hasta el detalle de una factura
 * o comprobante.
 *
 * Requiere OPENROUTER_API_KEY en env (y OCR_MODEL opcional para cambiar el
 * modelo).
 */
@Injectable()
export class OcrService {
  private readonly key = process.env.OPENROUTER_API_KEY || '';
  private readonly model =
    process.env.OCR_MODEL || 'google/gemini-3.1-flash-image';

  private get configurado(): boolean {
    return this.key.trim().length > 20;
  }

  /**
   * Extrae el texto de una imagen mediante visión IA. `imageBuffer` es la foto
   * (JPEG/PNG). Devuelve el texto crudo y los campos clave detectados.
   */
  async extractText(imageBuffer: Buffer): Promise<{ texto: string }> {
    if (!this.configurado) {
      return { texto: '' };
    }
    try {
      const b64 = imageBuffer.toString('base64');
      const body = {
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  '¿Qué documento muestra esta imagen? Si es una factura, ' +
                  'comprobante de pago o de transferencia, extrae TODOS los ' +
                  'datos legibles: tipo de documento, emisor/proveedor o ' +
                  'beneficiario, número o referencia, fecha, monto total, ' +
                  'método de pago, y cualquier otro dato relevante. ' +
                  'Responde en español, texto plano.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${b64}`,
                },
              },
            ],
          },
        ],
      };
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenRouter HTTP ${res.status}: ${err.slice(0, 200)}`);
      }
      const data = await res.json() as any;
      const texto =
        (data?.choices?.[0]?.message?.content as string) || '';
      return { texto: texto.trim() };
    } catch (e) {
      throw e;
    }
  }
}