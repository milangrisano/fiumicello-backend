import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoriaCarta } from '../entities/categoria-carta.entity';
import { ItemCarta } from '../entities/item-carta.entity';

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
  ) {}

  /** Public: return the full menu (categories + items, ordered) for any viewer. */
  async obtenerCarta(): Promise<CartaResponse> {
    const cats = await this.categorias.find({ order: { orden: 'ASC', id: 'ASC' } });
    const itms = await this.items.find({ order: { orden: 'ASC', id: 'ASC' } });

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

  // ---- Seed ----
  async seedIfEmpty() {
    const count = await this.categorias.count();
    if (count > 0) return;
    const now = new Date().toISOString();

    const cats = await this.categorias.save([
      this.categorias.create({ nombre: 'Pizzas', orden: 1, created_at: now }),
      this.categorias.create({ nombre: 'Pizzas de la Casa', orden: 2, created_at: now }),
      this.categorias.create({ nombre: 'Pastas', orden: 3, created_at: now }),
      this.categorias.create({ nombre: 'Paninis / Schiacciata', orden: 4, created_at: now }),
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
      // Pastas
      { cat: 'Pastas', nombre: 'Lasagna di Carne', desc: 'Ragù napolitano, besciamella y quesos', precio: 26900 },
      { cat: 'Pastas', nombre: 'Lasagna Mista', desc: 'Lasagna di Carne y pollo', precio: 28900 },
      // Paninis / Schiacciata
      { cat: 'Paninis / Schiacciata', nombre: 'Schiacciata di Parma', desc: 'Jamón crudo y pesto', precio: 36900 },
      { cat: 'Paninis / Schiacciata', nombre: 'Schiacciata di Bologna', desc: 'Mortadela y pistacho', precio: 26900 },
      // Bebidas
      { cat: 'Bebidas', nombre: 'Heineken', desc: null, precio: 12000 },
      { cat: 'Bebidas', nombre: 'Coca-Cola', desc: null, precio: 5000 },
      { cat: 'Bebidas', nombre: 'Agua sin gas', desc: null, precio: 3500 },
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