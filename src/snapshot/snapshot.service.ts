import { Pool } from 'pg';
import { execFile } from 'child_process';
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import { APP_VERSION } from '../app-version';

const RETENTION = parseInt(process.env.SNAPSHOT_RETENTION || '7', 10);

export class SnapshotService {
  /** Trigger: se ejecuta ANTES de NestFactory.create para capturar el estado
   *  previo a que TypeORM sincronice el esquema. No-op si la versión no cambió. */
  async runOnStartup(): Promise<void> {
    const db = {
      host: process.env.DB_HOST || 'db',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'fiumicello_user',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'fiumicello',
    };
    const dir = process.env.BACKUP_DIR || path.join(process.env.IMAGENES_DIR || '/app/archivos', 'BD_FIUMICELLO');
    const pool = new Pool(db);
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS _app_meta
        (key text PRIMARY KEY, value text, updated_at timestamptz DEFAULT now())`);
      const r = await pool.query(`SELECT value FROM _app_meta WHERE key='last_app_version'`);
      if (r.rows[0]?.value === APP_VERSION) return; // misma versión → no-op

      // Backup del contenido previo al bumpeo
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      const out = path.join(dir, `fiumicello_${APP_VERSION}_${stamp}.sql.gz`);
      await this.dump(db, out); // lanza si pg_dump falla (fail-fast)

      // Registrar versión aplicada
      await pool.query(
        `INSERT INTO _app_meta(key, value) VALUES('last_app_version', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
        [APP_VERSION],
      );
      console.log(`snapshot OK: ${out}`);
      this.prune(dir);
    } finally {
      await pool.end();
    }
  }

  private dump(db: { host: string; port: number; user: string; password: string; database: string }, out: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const pg = execFile(
        'pg_dump',
        ['-h', db.host, '-p', String(db.port), '-U', db.user, '-d', db.database,
         '--no-owner', '--no-privileges'],
        { env: { ...process.env, PGPASSWORD: db.password } },
      );
      if (!pg.stdout || !pg.stderr) {
        reject(new Error('snapshot falló: pg_dump sin stream de salida'));
        return;
      }
      const gz = zlib.createGzip();
      const ws = fs.createWriteStream(out);
      pg.stdout.pipe(gz).pipe(ws);
      pg.stderr.on('data', (d: Buffer) => console.warn('pg_dump stderr:', d.toString().trim()));
      pg.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', () => {
        pg.on('close', (code) => (code === 0 ? resolve() : reject(
          new Error(`snapshot falló: pg_dump exit ${code}`))));
      });
    });
  }

  private prune(dir: string): void {
    const files = fs.readdirSync(dir)
      .filter((f) => f.startsWith('fiumicello_') && f.endsWith('.sql.gz'))
      .sort().reverse();
    files.slice(RETENTION).forEach((f) => fs.unlinkSync(path.join(dir, f)));
  }
}