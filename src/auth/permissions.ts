/**
 * Catalog of permissions (modulos + acciones) for the Fiumicello app.
 *
 * A permission is a string like "modulo:accion" (e.g. "facturas:ver").
 * Roles (table `roles`) hold a set of these strings; the user inherits the
 * permissions of their role. This file is the fixed catalog the admin can
 * pick from when configuring a role — it is not hardcoded per role.
 *
 * JERARQUÍA DE 3 NIVELES (Enrique, nov-2026):
 *   Nivel 1 = botón del sidebar (POS, Facturas y comprobantes, Resúmenes,
 *             Administración). La Carta es pública y no se permiza.
 *   Nivel 2 = pestañas interiores de cada botón.
 *   Nivel 3 = CRUD por servicio que toca esa pestaña (Ver/Crear/Editar/
 *             Soft-delete). De aquí salen las casillas del árbol de la GUI.
 * El permiso `eliminar` = SOFT DELETE (borrado lógico) y solo se asigna
 * explícitamente (regla: ningún rol sin permiso explícito borra).
 */

export const PERMISSIONS = {
  // Facturas (purchase invoices)
  facturas_ver: 'facturas:ver',
  facturas_crear: 'facturas:crear',
  facturas_editar: 'facturas:editar',
  facturas_eliminar: 'facturas:eliminar', // soft-delete

  // Ventas / POS
  ventas_ver: 'ventas:ver',
  ventas_crear: 'ventas:crear',
  ventas_editar: 'ventas:editar',
  ventas_eliminar: 'ventas:eliminar', // soft-delete

  // Pedidos / mesas
  pedidos_anular: 'pedidos:anular', // anular mesa/pedido (aprobación admin/encargado)

  // Cocina
  cocina_ver: 'cocina:ver',
  cocina_actualizar: 'cocina:actualizar',

  // Caja
  caja_ver: 'caja:ver',
  caja_abrir: 'caja:abrir',
  caja_cerrar: 'caja:cerrar',
  caja_movimientos: 'caja:movimientos',
  caja_ingreso: 'caja:ingreso',       // autorizar ingresos (admin/encargado)
  propina_pagar: 'propina:pagar',

  // Resumenes / reportes
  resumenes_ver: 'resumenes:ver',

  // Admin: usuarios
  usuarios_gestionar: 'usuarios:gestionar',

  // Admin: roles & permisos
  roles_gestionar: 'roles:gestionar',

  // Admin: tokens de servicio
  tokens_gestionar: 'tokens:gestionar',

  // Carta (menu)
  carta_ver: 'carta:ver',
  carta_editar: 'carta:editar',

  // Auth (auto-grant a cualquier usuario autenticado/aprobado, NO atado a rol)
  auth_cambiar_clave: 'auth:cambiar-clave',
  auth_ver_mis_permisos: 'auth:ver-mis-permisos',
} as const;

export type Permission = string;

/** RFC5305-free helpers for the GUI tree. */

/** ¿Este permiso es un soft-delete (solo asignable con cuidado)? */
export const SOFT_DELETE_PERMISOS: ReadonlySet<string> = new Set([
  PERMISSIONS.facturas_eliminar,
  PERMISSIONS.ventas_eliminar,
]);

export interface PermisoCrud {
  permiso: string;
  etiqueta: string; // 'Ver' | 'Crear' | 'Editar' | 'Eliminar (soft)'
}
export interface ServicioPermisos {
  servicio: string; // ej. 'Pedidos', 'Ventas', 'Caja', 'Cocina'...
  crud: PermisoCrud[];
}
export interface PestanaPermisos {
  pestana: string; // ej. 'Nueva comanda', 'Cocina'...
  servicios: ServicioPermisos[];
}
export interface BotonPermisos {
  nivel1: string; // ej. 'POS', 'Facturas y comprobantes'...
  pestañas: PestanaPermisos[];
}

/** Catálogo para la GUI de roles — árbol de 3 niveles completo. */
export const CATALOGO_JERARQUICO: BotonPermisos[] = [
  {
    nivel1: 'POS',
    pestañas: [
      {
        pestana: 'Nueva comanda',
        servicios: [
          {
            servicio: 'Pedidos',
            crud: [
              { permiso: PERMISSIONS.ventas_crear, etiqueta: 'Crear' },
              { permiso: PERMISSIONS.ventas_ver, etiqueta: 'Ver' },
              { permiso: PERMISSIONS.ventas_editar, etiqueta: 'Editar' },
              { permiso: PERMISSIONS.ventas_eliminar, etiqueta: 'Eliminar (soft)' },
            ],
          },
          {
            servicio: 'Carta',
            crud: [{ permiso: PERMISSIONS.carta_ver, etiqueta: 'Ver' }],
          },
        ],
      },
      {
        pestana: 'Mesas abiertas',
        servicios: [
          {
            servicio: 'Pedidos',
            crud: [
              { permiso: PERMISSIONS.ventas_ver, etiqueta: 'Ver' },
              { permiso: PERMISSIONS.ventas_crear, etiqueta: 'Crear / cobrar' },
              { permiso: PERMISSIONS.pedidos_anular, etiqueta: 'Anular mesa' },
              { permiso: PERMISSIONS.ventas_eliminar, etiqueta: 'Eliminar (soft)' },
            ],
          },
          {
            servicio: 'Caja',
            crud: [{ permiso: PERMISSIONS.propina_pagar, etiqueta: 'Pagar propina' }],
          },
        ],
      },
      {
        pestana: 'Domicilios',
        servicios: [
          {
            servicio: 'Pedidos',
            crud: [
              { permiso: PERMISSIONS.ventas_ver, etiqueta: 'Ver' },
              { permiso: PERMISSIONS.ventas_crear, etiqueta: 'Crear / cobrar' },
              { permiso: PERMISSIONS.ventas_eliminar, etiqueta: 'Eliminar (soft)' },
            ],
          },
        ],
      },
      {
        pestana: 'Para llevar',
        servicios: [
          {
            servicio: 'Pedidos',
            crud: [
              { permiso: PERMISSIONS.ventas_ver, etiqueta: 'Ver' },
              { permiso: PERMISSIONS.ventas_crear, etiqueta: 'Crear / cobrar' },
              { permiso: PERMISSIONS.ventas_eliminar, etiqueta: 'Eliminar (soft)' },
            ],
          },
        ],
      },
      {
        pestana: 'Cocina',
        servicios: [
          {
            servicio: 'Cocina',
            crud: [
              { permiso: PERMISSIONS.cocina_ver, etiqueta: 'Ver órdenes' },
              { permiso: PERMISSIONS.cocina_actualizar, etiqueta: 'Actualizar estado' },
            ],
          },
        ],
      },
      {
        pestana: 'Movimientos de caja',
        servicios: [
          {
            servicio: 'Caja',
            crud: [
              { permiso: PERMISSIONS.caja_ver, etiqueta: 'Ver' },
              { permiso: PERMISSIONS.caja_movimientos, etiqueta: 'Ver movimientos' },
              { permiso: PERMISSIONS.caja_abrir, etiqueta: 'Abrir caja' },
              { permiso: PERMISSIONS.caja_cerrar, etiqueta: 'Cerrar caja' },
              { permiso: PERMISSIONS.caja_ingreso, etiqueta: 'Autorizar ingresos' },
            ],
          },
        ],
      },
      {
        pestana: 'Pago de propinas',
        servicios: [
          {
            servicio: 'Caja',
            crud: [{ permiso: PERMISSIONS.propina_pagar, etiqueta: 'Pagar propina' }],
          },
        ],
      },
    ],
  },
  {
    nivel1: 'Facturas y comprobantes',
    pestañas: [
      {
        pestana: 'Facturas',
        servicios: [
          {
            servicio: 'Facturas',
            crud: [
              { permiso: PERMISSIONS.facturas_ver, etiqueta: 'Ver' },
              { permiso: PERMISSIONS.facturas_crear, etiqueta: 'Crear' },
              { permiso: PERMISSIONS.facturas_editar, etiqueta: 'Editar' },
              { permiso: PERMISSIONS.facturas_eliminar, etiqueta: 'Eliminar (soft)' },
            ],
          },
        ],
      },
      {
        pestana: 'Comprobantes',
        servicios: [
          {
            servicio: 'Comprobantes',
            crud: [
              { permiso: PERMISSIONS.facturas_ver, etiqueta: 'Ver' },
              { permiso: PERMISSIONS.facturas_crear, etiqueta: 'Crear' },
              { permiso: PERMISSIONS.facturas_editar, etiqueta: 'Editar' },
            ],
          },
          {
            servicio: 'Gastos',
            crud: [{ permiso: PERMISSIONS.resumenes_ver, etiqueta: 'Ver resumen de gastos' }],
          },
        ],
      },
    ],
  },
  {
    nivel1: 'Resúmenes contables',
    pestañas: [
      {
        pestana: 'Resúmenes',
        servicios: [
          {
            servicio: 'Resúmenes',
            crud: [{ permiso: PERMISSIONS.resumenes_ver, etiqueta: 'Ver' }],
          },
          {
            servicio: 'Gastos',
            crud: [{ permiso: PERMISSIONS.resumenes_ver, etiqueta: 'Ver total gastos' }],
          },
        ],
      },
    ],
  },
  {
    nivel1: 'Administración',
    pestañas: [
      {
        pestana: 'Usuarios',
        servicios: [
          {
            servicio: 'Usuarios',
            crud: [{ permiso: PERMISSIONS.usuarios_gestionar, etiqueta: 'Gestionar usuarios' }],
          },
        ],
      },
      {
        pestana: 'Roles',
        servicios: [
          {
            servicio: 'Roles',
            crud: [{ permiso: PERMISSIONS.roles_gestionar, etiqueta: 'Gestionar roles/permisos' }],
          },
        ],
      },
      {
        pestana: 'Servicios / Tokens',
        servicios: [
          {
            servicio: 'Servicios',
            crud: [{ permiso: PERMISSIONS.tokens_gestionar, etiqueta: 'Gestionar tokens' }],
          },
        ],
      },
    ],
  },
];

/** Legacy flat list, kept for compat (permisosDeUsuario and old clients).
 *  Prefer CATALOGO_JERARQUICO for the role GUI. */
export interface PermissionDef {
  key: string;
  label: string;
  modulo: string;
}

export const PERMISSION_DEFS: PermissionDef[] = [
  // Facturas
  { key: PERMISSIONS.facturas_ver, label: 'Ver facturas', modulo: 'Facturas' },
  { key: PERMISSIONS.facturas_crear, label: 'Crear facturas', modulo: 'Facturas' },
  { key: PERMISSIONS.facturas_editar, label: 'Editar facturas', modulo: 'Facturas' },
  { key: PERMISSIONS.facturas_eliminar, label: 'Eliminar facturas (soft)', modulo: 'Facturas' },
  // Ventas / POS
  { key: PERMISSIONS.ventas_ver, label: 'Ver ventas', modulo: 'Ventas / POS' },
  { key: PERMISSIONS.ventas_crear, label: 'Crear ventas', modulo: 'Ventas / POS' },
  { key: PERMISSIONS.ventas_editar, label: 'Editar ventas', modulo: 'Ventas / POS' },
  { key: PERMISSIONS.ventas_eliminar, label: 'Eliminar ventas (soft)', modulo: 'Ventas / POS' },
  // Cocina
  { key: PERMISSIONS.pedidos_anular, label: 'Anular mesas / pedidos (aprobación)', modulo: 'Pos / Mesas' },
  { key: PERMISSIONS.cocina_ver, label: 'Ver órdenes de cocina', modulo: 'Cocina' },
  { key: PERMISSIONS.cocina_actualizar, label: 'Actualizar estado cocina', modulo: 'Cocina' },
  // Caja
  { key: PERMISSIONS.caja_ver, label: 'Ver caja', modulo: 'Caja' },
  { key: PERMISSIONS.caja_abrir, label: 'Abrir caja', modulo: 'Caja' },
  { key: PERMISSIONS.caja_cerrar, label: 'Cerrar caja', modulo: 'Caja' },
  { key: PERMISSIONS.caja_movimientos, label: 'Ver movimientos de caja', modulo: 'Caja' },
  { key: PERMISSIONS.caja_ingreso, label: 'Autorizar ingresos de caja', modulo: 'Caja' },
  { key: PERMISSIONS.propina_pagar, label: 'Pagar propina', modulo: 'Caja' },
  // Resumenes
  { key: PERMISSIONS.resumenes_ver, label: 'Ver resúmenes', modulo: 'Resúmenes' },
  // Admin usuarios
  { key: PERMISSIONS.usuarios_gestionar, label: 'Gestionar usuarios', modulo: 'Administración' },
  // Admin roles
  { key: PERMISSIONS.roles_gestionar, label: 'Gestionar roles', modulo: 'Administración' },
  // Admin tokens
  { key: PERMISSIONS.tokens_gestionar, label: 'Gestionar tokens', modulo: 'Administración' },
  // Carta
  { key: PERMISSIONS.carta_ver, label: 'Ver carta', modulo: 'Carta (menú)' },
  { key: PERMISSIONS.carta_editar, label: 'Editar carta', modulo: 'Carta (menú)' },
  // Autenticación (self-service: automático para todo usuario aprobado, no por rol)
  { key: PERMISSIONS.auth_cambiar_clave, label: 'Cambiar mi contraseña', modulo: 'Autenticación' },
  { key: PERMISSIONS.auth_ver_mis_permisos, label: 'Ver mis permisos (interfaz)', modulo: 'Autenticación' },
];

/** The SuperAdmin role is special: it implicitly has ALL permissions. */
export const SUPERADMIN_ROLE = 'superadmin';
