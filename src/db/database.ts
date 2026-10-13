import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { env } from '../config/env.js';
import type { Database } from './types.js';

const { Pool } = pg;

export const pool = new Pool({ connectionString: env.databaseUrl });

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool })
});

export async function closeDatabase(): Promise<void> {
  await db.destroy();
}
