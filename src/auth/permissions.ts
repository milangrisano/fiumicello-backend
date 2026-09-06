/**
 * Catalog of permissions (modulos + acciones) for the Fiumicello app.
 *
 * A permission is a string like "modulo:accion" (e.g. "facturas:ver").
 * Roles (table `roles`) hold a set of these strings; the user inherits the
 * permissions of their role. This file is the fixed catalog the admin can
 * pick from when configuring a role — it is not hardcoded per role.
 */

export const PERMISSIONS = {
  // Facturas (purchase invoices)
  facturas_ver: 'facturas:ver',
  facturas_crear: 'facturas:crear',
  facturas_editar: 'facturas:editar',
  facturas_eliminar: 'facturas:eliminar',

  // Ventas / POS
  ventas_ver: 'ventas:ver',
  ventas_crear: 'ventas:crear',
  ventas_editar: 'ventas:editar',
  ventas_eliminar: 'ventas:eliminar',

  // Cocina
  cocina_ver: 'cocina:ver',
  cocina_actualizar: 'cocina:actualizar',

  // Caja
  caja_ver: 'caja:ver',
  caja_cerrar: 'caja:cerrar',

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
} as const;

export type Permission = string;

/**
 * Ordered list of permission definitions, used by the "Roles & permisos"
 * admin screen to render the checkboxes grouped by module.
 */
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
  { key: PERMISSIONS.facturas_eliminar, label: 'Eliminar facturas', modulo: 'Facturas' },
  // Ventas / POS
  { key: PERMISSIONS.ventas_ver, label: 'Ver ventas', modulo: 'Ventas / POS' },
  { key: PERMISSIONS.ventas_crear, label: 'Crear ventas', modulo: 'Ventas / POS' },
  { key: PERMISSIONS.ventas_editar, label: 'Editar ventas', modulo: 'Ventas / POS' },
  { key: PERMISSIONS.ventas_eliminar, label: 'Eliminar ventas', modulo: 'Ventas / POS' },
  // Cocina
  { key: PERMISSIONS.cocina_ver, label: 'Ver órdenes de cocina', modulo: 'Cocina' },
  { key: PERMISSIONS.cocina_actualizar, label: 'Actualizar estado cocina', modulo: 'Cocina' },
  // Caja
  { key: PERMISSIONS.caja_ver, label: 'Ver caja', modulo: 'Caja' },
  { key: PERMISSIONS.caja_cerrar, label: 'Cerrar caja', modulo: 'Caja' },
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
];

/** The SuperAdmin role is special: it implicitly has ALL permissions. */
export const SUPERADMIN_ROLE = 'superadmin';