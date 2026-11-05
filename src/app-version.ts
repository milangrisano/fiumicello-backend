/** Versión de deploy del backend Fiumicello. Se bumpea a la par del frontend
 *  (lib/core/app_version.dart) para poder verificar en runtime qué imagen está
 *  sirviendo (coincidencia frontend vs backend). NUNCA desacoplar los bumps.
 */
export const APP_VERSION = '0.17.28';