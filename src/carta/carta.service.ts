import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoriaCarta } from '../entities/categoria-carta.entity';
import { ItemCarta } from '../entities/item-carta.entity';
import { VentaItem } from '../entities/venta-item.entity';

/** Shape returned to clients: categories with their items, ordered. */
export interface CartaResponse {
  categorias: Array<{
    id: number;
    nombre: string;
    items: Array<{
      id: number;
      nombre: string;
      descripcion: string | null;
      precio: number | null;
      precio_personal: number | null;
      precio_mediana: number | null;
      precio_grande: number | null;
    }>;
  }>;
}

@Injectable()
export class CartaService {
  constructor(
    @InjectRepository(CategoriaCarta)
    private readonly categorias: Repository<CategoriaCarta>,
    @InjectRepository(ItemCarta)
    private readonly items: Repository<ItemCarta>,
    @InjectRepository(VentaItem)
    private readonly ventaItems: Repository<VentaItem>,
  ) {}

  /** Public: return the menu showing ONLY active products. */
  async obtenerCarta(): Promise<CartaResponse> {
    return this._buildCarta(true);
  }

  /** Admin: return ALL products (active + disabled) for management. */
  async obtenerCartaAdmin(): Promise<CartaResponse> {
    return this._buildCarta(false);
  }

  private async _buildCarta(soloActivos: boolean): Promise<CartaResponse> {
    const cats = await this.categorias.find({ order: { orden: 'ASC', id: 'ASC' } });
    const itms = (await this.items.find({ order: { orden: 'ASC', id: 'ASC' } }))
      .filter((i) => !soloActivos || i.activo);

    return {
      categorias: cats.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        items: itms
          .filter((i) => i.id_categoria === c.id)
          .map((i) => ({
            id: i.id,
            nombre: i.nombre,
            descripcion: i.descripcion,
            precio: num(i.precio),
            precio_personal: num(i.precio_personal),
            precio_mediana: num(i.precio_mediana),
            precio_grande: num(i.precio_grande),
            activo: i.activo,
          })),
      })),
    };
  }

  // ---- CRUD (SuperAdmin/Admin) ----
  async crearCategoria(nombre: string, orden?: number) {
    return this.categorias.save(
      this.categorias.create({
        nombre,
        orden: orden ?? 0,
        created_at: new Date().toISOString(),
      }),
    );
  }

  async actualizarCategoria(id: number, nombre: string, orden?: number) {
    const c = await this.categorias.findOneBy({ id });
    if (!c) throw new NotFoundException('Categoría no encontrada.');
    if (nombre !== undefined) c.nombre = nombre;
    if (orden !== undefined) c.orden = orden;
    return this.categorias.save(c);
  }

  async eliminarCategoria(id: number) {
    await this.categorias.delete(id);
    await this.items.delete({ id_categoria: id });
    return { ok: true };
  }

  async crearItem(data: Partial<ItemCarta>) {
    return this.items.save(
      this.items.create({ ...data, created_at: new Date().toISOString() }),
    );
  }

  async actualizarItem(id: number, data: Partial<ItemCarta>) {
    const it = await this.items.findOneBy({ id });
    if (!it) throw new NotFoundException('Item no encontrado.');
    Object.assign(it, data);
    return this.items.save(it);
  }

  async eliminarItem(id: number) {
    await this.items.delete(id);
    return { ok: true };
  }

  /**
   * Toggle a product's active state (enable/disable).
   * Disabled products are hidden from the public carta but kept for history.
   */
  async toggleActivo(id: number): Promise<{ ok: boolean; activo: boolean }> {
    const it = await this.items.findOneBy({ id });
    if (!it) throw new NotFoundException('Producto no encontrado.');
    it.activo = !it.activo;
    await this.items.save(it);
    return { ok: true, activo: it.activo };
  }

  /**
   * Delete a product. If it has ever been sold (exists in venta_items), it
   * cannot be deleted — only disabled is allowed (history preserved).
   */
  async eliminarProducto(id: number) {
    const vendidos = await this.ventaItems.count({ where: { id_producto: id } });
    if (vendidos > 0) {
      throw new ForbiddenException(
        'No se puede eliminar porque ya se vendió. Puedes deshabilitarlo.',
      );
    }
    await this.eliminarItem(id);
    return { ok: true };
  }

  // ---- Seed ----
  async seedIfEmpty() {
    const count = await this.categorias.count();
    if (count > 0) return;
    const now = new Date().toISOString();

    const cats = await this.categorias.save([
      this.categorias.create({ nombre: 'Pizzas', orden: 1, created_at: now }),
      this.categorias.create({ nombre: 'Pizzas de la Casa', orden: 2, created_at: now }),
      this.categorias.create({ nombre: 'Lasagnas', orden: 3, created_at: now }),
      this.categorias.create({ nombre: 'Paninis', orden: 4, created_at: now }),
      this.categorias.create({ nombre: 'Bebidas', orden: 5, created_at: now }),
    ]);
    const byName = Object.fromEntries(cats.map((c) => [c.nombre, c.id]));

    const M: Record<string, number | null> = { p: null };
    const semilla: Array<{
      cat: keyof typeof byName;
      nombre: string;
      desc: string | null;
      precio?: number | null;
      personal?: number | null;
      mediana?: number | null;
      grande?: number | null;
    }> = [
      // Pizzas (7)
      { cat: 'Pizzas', nombre: 'Margherita', desc: 'Salsa pomodoro, queso mozzarella y pesto de albahaca de la casa', personal: 20900, mediana: 44900, grande: 63900 },
      { cat: 'Pizzas', nombre: 'Pollo y Champiñón', desc: 'Salsa pomodoro, queso mozzarella, pollo desmechado y champiñones salteados', personal: 22900, mediana: 44900, grande: 63900 },
      { cat: 'Pizzas', nombre: 'Pepperoni', desc: 'Salsa pomodoro, queso mozzarella y pepperoni tipo americano', personal: 24900, mediana: 48900, grande: 68900 },
      { cat: 'Pizzas', nombre: 'Hawaiana', desc: 'Salsa pomodoro, queso mozzarella, jamón ahumado, piña caramelizada', personal: 24900, mediana: 50900, grande: 72900 },
      { cat: 'Pizzas', nombre: 'Maíz Guanciale', desc: 'Salsa pomodoro, maíz dulce y Guanciale', personal: 23900, mediana: 46900, grande: 71900 },
      { cat: 'Pizzas', nombre: 'Vegetariana', desc: 'Salsa pomodoro, queso mozzarella, pimentón asado, cebolla, aceitunas negras, champiñones salteados y corazones de alcachofa', personal: 28900, mediana: 53900, grande: 79900 },
      { cat: 'Pizzas', nombre: 'Napolitana', desc: 'Salsa pomodoro, queso mozzarella y anchoas', personal: 27900, mediana: 52900, grande: 77900 },
      // Pizzas de la Casa (7)
      { cat: 'Pizzas de la Casa', nombre: 'Quatro Formaggi', desc: 'Salsa pomodoro, queso provolone, gorgonzola dolce, Parmegiano Reggiano y mozzarella', personal: 34900, mediana: 64900, grande: 96900 },
      { cat: 'Pizzas de la Casa', nombre: 'Coppa', desc: 'Salsa pomodoro, queso mozzarella, Fior di latte y capicola', personal: 34900, mediana: 64900, grande: 96900 },
      { cat: 'Pizzas de la Casa', nombre: 'Prosciutto Crudo e Rucula', desc: 'Salsa pomodoro, queso mozzarella, Prosciutto Crudo y rúcula fresca', personal: 34900, mediana: 64900, grande: 96900 },
      { cat: 'Pizzas de la Casa', nombre: 'Quattro Maiale', desc: 'Salsa pomodoro, queso mozzarella, salamino, tocineta ahumada, jamón cocido curado y pepperoni tipo americano', personal: 29900, mediana: 57900, grande: 85900 },
      { cat: 'Pizzas de la Casa', nombre: 'Salametto', desc: 'Salsa pomodoro, queso mozzarella, salami madurado italiano', personal: 31900, mediana: 62900, grande: 92900 },
      { cat: 'Pizzas de la Casa', nombre: 'Prosciutto e Funghi', desc: 'Salsa pomodoro, queso mozzarella, jamón cocido y curado, champiñones salteados', personal: 27900, mediana: 51900, grande: 76900 },
      { cat: 'Pizzas de la Casa', nombre: 'Salami y Vegetales', desc: 'Salsa pomodoro, queso mozzarella, salamino, pimentón asado, cebolla, aceitunas negras, anchoas', personal: 29900, mediana: 56900, grande: 83900 },
      // Lasagnas
      { cat: 'Lasagnas', nombre: 'Lasagna di Carne', desc: 'Salsa ragù napolitano, besciamella y quesos gratinados', precio: 26900 },
      { cat: 'Lasagnas', nombre: 'Lasagna Mista', desc: 'Lasagna di Carne y pollo', precio: 28900 },
      // Paninis (4)
      { cat: 'Paninis', nombre: 'Schiacciata di Parma', desc: 'Schiacciata de ajo y orégano, pesto di basilico, prosciutto crudo di Parma, fiordilatte, tomate fresco, rúcula fresca, aceite de oliva y aceto balsámico de Módena', precio: 36900 },
      { cat: 'Paninis', nombre: 'Schiacciata di Bologna', desc: 'Schiacciata de ajo y orégano, pesto di basilico, mortadela di pistachio, fiordilatte, tomate y rúcula fresca, aceite de oliva y aceto balsámico de Módena', precio: 26900 },
      { cat: 'Paninis', nombre: 'Schiacciata di Córcega', desc: 'Schiacciata de ajo y orégano, pesto di basilico, tomates y rúcula fresca, coppa o capicola, fiordilatte, tomate fresco, aceite de oliva y aceto balsámico de Módena', precio: 32900 },
      { cat: 'Paninis', nombre: 'Schiacciata Cotto', desc: 'Schiacciata de ajo y orégano, pesto di albahaca y tomates secos, prosciutto cotto Módena, fiordilatte, tomate y rúcula fresca, aceite de oliva y aceto balsámico de Módena', precio: 28900 },
      // Bebidas (13, grouped by family in the description)
      { cat: 'Bebidas', nombre: '3 Cordilleras', desc: 'Cerveza', precio: 10000 },
      { cat: 'Bebidas', nombre: 'Heineken', desc: 'Cerveza', precio: 12000 },
      { cat: 'Bebidas', nombre: 'Miller Lite', desc: 'Cerveza', precio: 10000 },
      { cat: 'Bebidas', nombre: 'Té Hatsu Blanco', desc: 'Té', precio: 8000 },
      { cat: 'Bebidas', nombre: 'Té Hatsu Lila', desc: 'Té', precio: 8000 },
      { cat: 'Bebidas', nombre: 'Té Hatsu Negro', desc: 'Té', precio: 8000 },
      { cat: 'Bebidas', nombre: 'Coca-Cola Original', desc: 'Gaseosa', precio: 5000 },
      { cat: 'Bebidas', nombre: 'Coca-Cola Zero', desc: 'Gaseosa', precio: 5000 },
      { cat: 'Bebidas', nombre: 'Ginger Ale', desc: 'Gaseosa', precio: 4500 },
      { cat: 'Bebidas', nombre: 'Quatro', desc: 'Gaseosa', precio: 4500 },
      { cat: 'Bebidas', nombre: 'Sprite', desc: 'Gaseosa', precio: 4500 },
      { cat: 'Bebidas', nombre: 'Agua sin gas', desc: 'Agua', precio: 3500 },
      { cat: 'Bebidas', nombre: 'Agua con gas', desc: 'Agua', precio: 4000 },
    ];

    await this.items.save(
      semilla.map((s, i) =>
        this.items.create({
          id_categoria: byName[s.cat],
          nombre: s.nombre,
          descripcion: s.desc,
          precio: s.precio != null ? s.precio : null,
          precio_personal: s.personal != null ? s.personal : null,
          precio_mediana: s.mediana != null ? s.mediana : null,
          precio_grande: s.grande != null ? s.grande : null,
          orden: i,
          created_at: now,
        }),
      ),
    );
  }
}

function num(v: number | string | null): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}