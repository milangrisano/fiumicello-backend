import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Logger,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { OcrService } from './ocr.service';
import { SidecarService } from './sidecar.service';
import { FacturasService } from '../facturas/facturas.service';
import { ComprobantesService } from '../comprobantes/comprobantes.service';
import { RequirePermiso } from '../auth/permiso.decorator';
import { PERMISSIONS } from '../auth/permissions';
import {
  resolverArchivo,
  esMejor,
  motivoMejor,
  medirImagen,
  calcularBlur,
  MIN_PIXELS_ABSURDOS,
  MIN_BLUR,
  MIN_PIXELS_PEQUENA,
  MIN_BLUR_PEQUENA,
} from './resolucion';

/**
 * Raíz de imágenes servida por nginx como `/archivos/...`. Configurable por
 * env (IMAGENES_DIR). Se replica igual en Lenovo (producción).
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
  private readonly logger = new Logger('Ocr');

  constructor(
    private readonly ocr: OcrService,
    private readonly sidecar: SidecarService,
    private readonly facturas: FacturasService,
    private readonly comprobantes: ComprobantesService,
  ) {
    fs.mkdirSync(IMAGENES_DIR, { recursive: true });
    for (const s of Object.values(SUB)) {
      fs.mkdirSync(path.join(IMAGENES_DIR, s), { recursive: true });
    }
  }

  /**
   * Toma una foto de factura/comprobante, la guarda, y con visión IA detecta
   * el tipo y los datos. Luego CREA automáticamente el registro (factura o
   * comprobante) con esos datos, sin que la interfaz tenga que preguntar nada.
   * Devuelve el registro creado (o si ya existía, para avisarlo).
   */
  @Post('subir')
  @RequirePermiso(PERMISSIONS.facturas_crear)
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
  async subir(@Req() req: Request, @UploadedFile() file?: Express.Multer.File) {
    // OCR de carga automática: SOLO tokens de servicio (herb y n8n). La
    // interfaz humana (JWT sin nombreServicio) NO lo puede usar.
    const usuario = (req as unknown as { user?: { nombreServicio?: string | null } }).user;
    if (!usuario || !usuario.nombreServicio) {
      throw new ForbiddenException('OCR dedicado a un servicio autorizado.');
    }
    if (!file) throw new BadRequestException('No se recibió ningún archivo.');
    const rutaOriginal = file.path;
    const buffer = fs.readFileSync(rutaOriginal);

    let resultado: Awaited<ReturnType<OcrService['extractText']>>;
    try {
      resultado = await this.ocr.extractText(buffer, file.mimetype);
    } catch (e) {
      fs.rmSync(rutaOriginal, { force: true });
      this.logger.error('OCR error', e as any);
      return {
        ok: false,
        error: 'No se pudo leer la imagen (visión IA). Trata de nuevo.',
      };
    }

    // ── CAPA 1: rechazo por CALIDAD (desenfoque) — MIX (REPORTE-CAPA1-CALIDAD-BLUR) ──
    // El criterio real de legibilidad no es el tamaño (los documentos contables
    // tienen mil proporciones legítimas: bouchers 245×1280, capturas largas),
    // sino la nitidez: varianza del Laplaciano (blur score). Una imagen borrosa
    // es la que hace alucinar al OCR y crear facturas inventadas.
    // MIX de dos niveles (sin estirar — withoutEnlargement):
    //   - Grandes (>=150.000 px): blur nativo >= MIN_BLUR (20).
    //   - Pequeñas (<150.000 px): blur nativo >= MIN_BLUR_PEQUENA (650), porque
    //     una reducción ilegible (25%/35%) se ve "nítida" a su escala pero no
    //     es legible; una captura nítida pequeña (200×200) da blur mucho mayor.
    // Se mantiene un mínimo absoluto de píxeles para tamaños absurdos.
    // Aplica a imágenes (no a PDFs, que llevan capa/tamaño de página suficiente).
    if (file.mimetype && !String(file.mimetype).toLowerCase().includes('pdf')) {
      const dims = await medirImagen(rutaOriginal);
      const blur = await calcularBlur(rutaOriginal); // nativo (sin estirar)
      const tamAbsurdo =
        dims.pixels > 0 && dims.pixels < MIN_PIXELS_ABSURDOS;
      const pequena = dims.pixels > 0 && dims.pixels < MIN_PIXELS_PEQUENA;
      const umbral = pequena ? MIN_BLUR_PEQUENA : MIN_BLUR;
      const borrosa = blur >= 0 && blur < umbral;
      if (tamAbsurdo || borrosa) {
        fs.rmSync(rutaOriginal, { force: true }); // no dejar residuo del temporal
        this.logger.warn(
          `OCR rechazado por calidad: ${file.originalname} (${dims.width}×${dims.height}, ${dims.pixels}px, blur=${blur.toFixed(1)}, umbral=${umbral}, ${tamAbsurdo ? 'tamaño absurdo' : pequena ? 'pequeña insuficientemente nítida' : 'borrosa'})`);
        return {
          ok: false,
          error:
            'Imagen de muy baja resolución/ilegible. Reenvía el documento en mayor resolución.',
        };
      }
    }

    // Mover la imagen a su subcarpeta según el tipo detectado, con el nombre
    // estructurado AAAAMMDD_REF_PROVEEDOR (igual que /api/escaneo/confirmar) para
    // que el mapeo/barrido de producción sea consistente entre ambos flujos.
    // REF = número de factura o nº de comprobante (depósito/transferencia).
    const carpeta = subcarpeta(resultado.tipo ?? undefined);
    let relativo = file.filename;
    if (carpeta) {
      let aaammdd = String(resultado.fecha || '').replace(/[^0-9]/g, '');
      if (aaammdd.length !== 8 && aaammdd.length >= 4) aaammdd = `${aaammdd}0000`.slice(0, 8);
      if (aaammdd.length < 8) aaammdd = '00000000';
      const prov = String(resultado.beneficiario || '')
        .trim().replace(/\s+/g, '-')
        .replace(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ._-]/g, '');
      const ref = String(resultado.referencia || '').trim().replace(/[^A-Za-z0-9._-]/g, '');
      const ext = path.extname(file.originalname || file.filename) || '.jpg';
      const nombre = `${aaammdd}_${ref || 'SREF'}_${prov || 'SPROV'}${ext}`;
      if (resultado.tipo === 'factura') {
        const aa = aaammdd.slice(0, 4);
        const mm = aaammdd.slice(4, 6);
        relativo = path.join('facturas', aa, mm, nombre);
      } else {
        relativo = path.join(carpeta, nombre);
      }
      const destino = path.join(IMAGENES_DIR, relativo);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.renameSync(rutaOriginal, destino);
    }
    // Ruta completa relativa (con subcarpeta) para que la URL /archivos/<archivo>
    // apunte al lugar real donde se guardó el archivo.
    const archivoGuardado = relativo.replace(/\\/g, '/');

    // ── CAPA 2: validación de coherencia del OCR (REPORTE-BUG-BAJA-RESOLUCION) ──
    // Si aun con resolución OK la IA produce referencia genérica/inventada
    // (000000, SREF, SEC..., sin dígitos) o fecha no plausible, NO crear: es
    // señal de documento ilegible. Mejor rechazar que insertar un dato falso.
    const refLeida = String(resultado.referencia || '').trim();
    const refEsInventada =
        refLeida === '' ||
        /^sref$/i.test(refLeida) ||
        /^[a-z]*0{3,}$/i.test(refLeida) || // "000000"
        (/^sec/i.test(refLeida) && !/\d{6,}/.test(refLeida)); // "SECF32039" sin nº largo
    let fechaNoPlausible = false;
    const anioLeido =
        Number(String(resultado.fecha || '').slice(0, 4));
    if (anioLeido > 0 && (anioLeido < 2020 || anioLeido > new Date().getFullYear() + 1)) {
      fechaNoPlausible = true;
    }
    if (refEsInventada || fechaNoPlausible) {
      fs.rmSync(path.join(IMAGENES_DIR, archivoGuardado), { force: true });
      this.logger.warn(
        `OCR rechazado por datos incoherentes: ${file.originalname} → ref '${refLeida}' fecha '${resultado.fecha ?? ''}'`);
      return {
        ok: false,
        error:
          'El documento no se pudo leer con fiabilidad (datos incoherentes). Reenvía el documento en mayor resolución.',
      };
    }

    // Crear el registro automáticamente con los datos leídos.
    let creado: any = null;
    let yaExistia = false;
    let mensaje = '';
    let archivoExistente: string | null = null;
    try {
      if (resultado.tipo === 'factura') {
        // CAPA 3: dedupe fuzzy por proveedor + total ±1% (REPORTE-BUG-BAJA-RESOLUCION).
        // Cubre el caso donde el número de factura se leyó mal (imagen baja calidad):
        // aunque numero_factura no coincida, proveedor+total ≈ = mismo documento.
        const totalLeido = parseFloat(resultado.total ?? '');
        const cerca = await this.facturas.findFuzzy(
          resultado.beneficiario,
          totalLeido,
        );
        if (cerca) {
          // Reencauzar a la consolidación: NO borrar el archivo nuevo (degradaría la
          // resolución si es mejor que el del registro, o lo dejaría sin archivo).
          // Se marca como duplicado y se delega a la consolidación posterior
          // (que conserva la mejor resolución y restaura si falta).
          yaExistia = true;
          creado = { id: cerca.id };
          archivoExistente = String(cerca.archivo ?? '');
          mensaje =
            'Posible duplicado (mismo proveedor y monto). ¿Es el mismo documento reenviado?';
        } else {
          creado = await this.facturas.create({
            proveedor: resultado.beneficiario || undefined,
            fecha: resultado.fecha || undefined,
            numero_factura: resultado.referencia || undefined,
            total_con_impuestos: parseFloat(resultado.total) || undefined,
            archivo: archivoGuardado,
            items: resultado.items?.length
              ? resultado.items.map((it) => ({
                  descripcion: it.descripcion,
                  cantidad: it.cantidad,
                  precio_unitario: it.precio_unitario,
                  base_imponible: it.base_imponible,
                  iva: it.iva,
                  total: it.total,
                }))
              : undefined,
          });
          mensaje = 'Factura creada';
        }
      } else if (
        resultado.tipo === 'comprobante_pago' ||
        resultado.tipo === 'comprobante_transferencia'
      ) {
        creado = await this.comprobantes.create({
          beneficiario_emisor: resultado.beneficiario || undefined,
          fecha: resultado.fecha || undefined,
          referencia: resultado.referencia || undefined,
          total_con_impuestos: parseFloat(resultado.total) || undefined,
          archivo: archivoGuardado,
        });
        mensaje = 'Comprobante creado';
      } else {
        mensaje = 'Documento guardado, pero no se pudo determinar el tipo';
      }
    } catch (e: any) {
      // Duplicado (o validación): no romper el flujo.
      yaExistia = true;
      mensaje =
        (e?.response?.message as string) ||
        e?.message ||
        'No se pudo crear';
      const id = e?.response?.message?.match(/id (\d+)/i)?.[1];
      creado = id ? { id: Number(id) } : null;
      // Duplicado: recuperar la ruta del archivo que el registro ya tiene
      // guardado, para compararla con la recién llegada y quedarnos con la
      // de mejor definición (plan PLAN-COMPARAR-RESOLUCION).
      if (id) {
        try {
          if (resultado.tipo === 'factura') {
            const existente = await this.facturas.findOne(Number(id));
            archivoExistente = (existente as any)?.archivo ?? null;
          } else {
            const existente = await this.comprobantes.findOne(Number(id));
            archivoExistente = (existente as any)?.archivo ?? null;
          }
        } catch (err) {
          this.logger.warn(
            `No se pudo leer el archivo del duplicado id=${id}: ${(err as Error).message}`,
          );
        }
      }
    }

    // ── Consolidación por resolución (solo duplicados) ────────────────
    // Si el documento ya existía, comparar el archivo recién llegado con el
    // que el registro ya tiene y conservar el de mejor definición, dejando
    // SIEMPRE 1 archivo (la ruta del registro) + 1 sidecar, sin huérfanos.
    // REGLA DE INTEGRIDAD: la consolidación NUNCA debe dejar el volumen sin
    // el archivo del registro. Nunca se borra rutaExistente antes de tener
    // su reemplazo garantizado (renameSync reemplaza atómicamente).
    // (Fix REPORTE-BUG-CONSOLIDACION-DESTRUYE-ARCHIVO)
    let conservado: 'existente' | 'nuevo' | null = null;
    let motivoConservacion = '';
    if (yaExistia && archivoExistente) {
      const rutaNuevo = path.join(IMAGENES_DIR, archivoGuardado);
      const rutaExistente = path.join(IMAGENES_DIR, archivoExistente);
      const mismaRuta = path.normalize(rutaNuevo) === path.normalize(rutaExistente);
      try {
        if (mismaRuta) {
          // Misma ruta normalizada (misma fecha+ref+proveedor): el paso de
          // normalización ya dejó (renameSync línea anterior) el archivo recién
          // subido en la ruta del registro, reemplazándolo. NO hay dos archivos
          // que comparar (comparar la ruta consigo misma daría "no mejor" y el
          // borrado se llevaría el único archivo). Conservar tal cual y solo
          // regenerar el sidecar. NUNCA rmSync/renameSync sobre la misma ruta.
          conservado = 'existente';
          motivoConservacion =
            'misma ruta normalizada; el archivo recién subido ya quedó en la ruta del registro';
        } else {
          const existeNuevo = fs.existsSync(rutaNuevo);
          const existeExistente = fs.existsSync(rutaExistente);
          if (existeNuevo && existeExistente) {
            const rNuevo = await resolverArchivo(rutaNuevo);
            const rExistente = await resolverArchivo(rutaExistente);
            if (esMejor(rNuevo, rExistente)) {
              // El nuevo es mejor: su contenido reemplaza al del registro.
              // renameSync reemplaza el destino atómicamente y elimina el nuevo;
              // NO hay rmSync previo que pueda dejar la ruta sin archivo.
              fs.renameSync(rutaNuevo, rutaExistente);
              conservado = 'nuevo';
              motivoConservacion = `${motivoMejor(rNuevo)} (nuevo) > ${motivoMejor(rExistente)} (existente)`;
            } else {
              // El existente es mejor o igual: el nuevo no debe quedar huérfano.
              fs.rmSync(rutaNuevo, { force: true });
              conservado = 'existente';
              motivoConservacion = `${motivoMejor(rExistente)} (existente) >= ${motivoMejor(rNuevo)} (nuevo)`;
            }
          } else if (!existeExistente && existeNuevo) {
            // Registro apuntando a un archivo inexistente (bug previo lo dejó sin
            // archivo): el único archivo real disponible es el nuevo. Adoptarlo
            // (restaura el registro) dejándolo en la ruta que la BD espera.
            fs.renameSync(rutaNuevo, rutaExistente);
            conservado = 'nuevo';
            motivoConservacion = 'el registro apuntaba a un archivo inexistente; adoptado el nuevo (restauración)';
          } else {
            // (existeExistente && !existeNuevo) o ambos ausentes: no hay reemplazo,
            // conservar el existente tal cual.
            conservado = 'existente';
            motivoConservacion = 'no hay archivo nuevo a consolidar';
          }
        }
      } catch (err) {
        this.logger.warn(`Consolidación de resolución omitida: ${(err as Error).message}`);
      }
      // GUARD DE INTEGRIDAD (BUG 1): tras consolidar, la ruta del registro DEBE
      // existir. Si no, restaurar desde el temporal de la subida si aún está, o
      // NO dejar el registro apuntando a algo que no existe.
      if (conservado && !fs.existsSync(rutaExistente)) {
        if (fs.existsSync(rutaNuevo)) {
          fs.renameSync(rutaNuevo, rutaExistente);
          this.logger.warn(
            `Guard de integridad: ruta del registro no existía; restaurada desde ${archivoGuardado}`,
          );
        } else {
          this.logger.error(
            `Guard de integridad: el archivo del registro ${archivoExistente} NO existe ni se pudo restaurar`,
          );
          conservado = null;
        }
      }
    }

    // Escribir el sidecar JSON junto a la imagen (convención X.jpg ↔ X.json).
    // Aunque el registro ya existiera (duplicado), el sidecar se regenera con
    // los datos leídos para mantener la carpeta de imágenes siempre consistente.
    // En duplicado consolidado, el sidecar vive bajo la ruta del registro
    // (la que sobrevive), nunca bajo la del archivo desechado.
    const archivoSidecar = conservado ? archivoExistente! : archivoGuardado;
    if (carpeta && resultado.tipo) {
      const datosSidecar: Record<string, unknown> = {
        tipo: resultado.tipo,
      };
      if (resultado.fecha) datosSidecar.fecha = resultado.fecha;
      if (resultado.referencia) {
        resultado.tipo === 'factura'
          ? (datosSidecar.numero_factura = resultado.referencia)
          : (datosSidecar.referencia = resultado.referencia);
      }
      if (resultado.beneficiario) {
        resultado.tipo === 'factura'
          ? (datosSidecar.proveedor = resultado.beneficiario)
          : (datosSidecar.beneficiario_emisor = resultado.beneficiario);
      }
      if (resultado.total) {
        datosSidecar.total_con_impuestos = parseFloat(resultado.total) || undefined;
        datosSidecar.moneda = 'COP';
      }
      const sidecarPath = this.sidecar.write(
        IMAGENES_DIR,
        archivoSidecar,
        { archivo: archivoSidecar, datos: datosSidecar, usage: null },
      );
      // Si el archivo desechado tenía sidecar propio (queda huérfano), quitarlo.
      if (conservado && archivoGuardado !== archivoSidecar) {
        const sidecarHuerfano = path.join(
          IMAGENES_DIR,
          SidecarService.sidecarPath(archivoGuardado),
        );
        if (fs.existsSync(sidecarHuerfano)) {
          fs.rmSync(sidecarHuerfano, { force: true });
          this.logger.log(`Sidecar huérfano eliminado: ${sidecarHuerfano}`);
        }
      }
      this.logger.log(`Sidecar escrito: ${sidecarPath}`);
    }

    // El archivo que FINALMENTE quedó en el volumen. En consolidación de
    // duplicados la ruta que sobrevive es archivoExistente (la del registro);
    // en creación normal es archivoGuardado. (Fix REPORTE-BUG-CONSOLIDACION-DESTRUYE-ARCHIVO)
    const archivoFinal = conservado ? archivoExistente! : archivoGuardado;
    const archivo_url_final = `/archivos/${archivoFinal}`;

    return {
      ok: true,
      tipo: resultado.tipo,
      creado: !yaExistia && creado != null,
      ya_existia: yaExistia,
      mensaje,
      id: (creado as any)?.id ?? null,
      archivo: archivoGuardado,
      archivo_url: archivo_url_final,
      beneficiario: resultado.beneficiario,
      fecha: resultado.fecha,
      total: resultado.total,
      referencia: resultado.referencia,
      texto: resultado.texto,
      // Trazabilidad de consolidación (solo aparece en duplicados): qué archivo
      // quedó y por qué, para que herb/Enrique puedan ver la decisión.
      ...(conservado
        ? {
            resolucion: {
              conservada: conservado,
              archivo: archivoExistente,
              motivo: motivoConservacion,
            },
          }
        : {}),
    };
  }
}