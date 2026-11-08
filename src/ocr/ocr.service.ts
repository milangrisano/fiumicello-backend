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
     * Lee una imagen mediante visión IA y devuelve el tipo detectado + datos.
     * El modelo devuelve JSON con: tipo, texto, beneficiario/proveedor, fecha,
     * total, referencia. La interfaz usa eso para pre-rellenar el formulario.
     */
    async extractText(
      imageBuffer: Buffer,
      mimeType?: string,
    ): Promise<{
      tipo: string | null;
      texto: string;
      beneficiario: string;
      fecha: string;
      total: string;
      referencia: string;
      items?: Array<{
        descripcion?: string;
        cantidad?: number;
        precio_unitario?: number;
        base_imponible?: number;
        iva?: number;
        total?: number;
      }>;
    }> {
      const vacio = {
        tipo: null,
        texto: '',
        beneficiario: '',
        fecha: '',
        total: '',
        referencia: '',
      };
      if (!this.configurado) return vacio;

      try {
        const b64 = imageBuffer.toString('base64');
        // Usar el MIME recibido (p.ej. application/pdf para PDFs, image/jpeg
        // para fotos); si no viene, inferir por el contenido o asumir jpeg.
        let tipoMime = mimeType?.trim().toLowerCase() || '';
        if (!tipoMime) {
          const cab = imageBuffer.subarray(0, 8).toString('latin1');
          tipoMime = cab.startsWith('%PDF') ? 'application/pdf' : 'image/jpeg';
        }
        const body = {
          model: this.model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    'Analiza esta imagen (factura o comprobante bancario). ' +
                    'Responde SOLO con JSON válido, sin texto extra, con esta forma:\n' +
                    '{\n' +
                    '  "tipo": "factura" | "comprobante_pago" | "comprobante_transferencia",\n' +
                    '  "beneficiario": "emisor o beneficiario",\n' +
                    '  "fecha": "YYYY-MM-DD",\n' +
                    '  "total": "12345.67" (solo el número),\n' +
                    '  "referencia": "número o referencia",\n' +
                    '  "texto": "texto legible del documento",\n' +
                    '  "items": [\n' +
                    '    {\n' +
                    '      "descripcion": "descripción del producto/servicio",\n' +
                    '      "cantidad": 2,\n' +
                    '      "precio_unitario": 12000,\n' +
                    '      "base_imponible": 24000,\n' +
                    '      "iva": 4560,\n' +
                    '      "total": 28560\n' +
                    '    }\n' +
                    '  ]\n' +
                    '}\n' +
                    'Los ítems son las líneas del detalle de la factura (productos o ' +
                    'servicios). Si la factura los lista, completa cada línea con su ' +
                    'descripción, cantidad, precio unitario, base imponible, IVA y ' +
                    'total por línea. Si no hay detalle legible, devuelve "items": [].\n' +
                    'Clasifica: si es una factura de compra (vendedor, proveedor) ' +
                    '-> "factura"; si es un comprobante/recibo de pago a un proveedor ' +
                    '-> "comprobante_pago"; si es una consignación o transferencia ' +
                    'entre cuentas (banco, Nequi, cuenta propia) -> "comprobante_transferencia". ' +
                    'Si no hay texto legible, devuelve texto vacío y tipo null.',
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${tipoMime};base64,${b64}`,
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
        const data = (await res.json()) as any;
        const content = (data?.choices?.[0]?.message?.content as string) || '';

        // Extraer el objeto JSON del contenido (a veces viene envuelto en ```json).
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const raw = jsonMatch ? jsonMatch[0] : '';
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = {};
        }

        const tipo = (
          [
            'factura',
            'comprobante_pago',
            'comprobante_transferencia',
          ] as const
        ).includes(parsed.tipo as any)
          ? (parsed.tipo as string)
          : null;
        return {
          tipo,
          texto: String(parsed.texto ?? '').trim(),
          beneficiario: String(parsed.beneficiario ?? '').trim(),
          fecha: String(parsed.fecha ?? '').trim(),
          total: String(parsed.total ?? '').trim(),
          referencia: String(parsed.referencia ?? '').trim(),
          items: Array.isArray(parsed.items)
            ? (parsed.items as Array<Record<string, unknown>>)
                .map((it) => ({
                  descripcion: String(it.descripcion ?? '').trim() || undefined,
                  cantidad: typeof it.cantidad === 'number' ? it.cantidad : undefined,
                  precio_unitario:
                    typeof it.precio_unitario === 'number' ? it.precio_unitario : undefined,
                  base_imponible:
                    typeof it.base_imponible === 'number' ? it.base_imponible : undefined,
                  iva: typeof it.iva === 'number' ? it.iva : undefined,
                  total: typeof it.total === 'number' ? it.total : undefined,
                }))
                .filter((it) => it.descripcion)
            : undefined,
        };
      } catch (e) {
        throw e;
      }
    }
}