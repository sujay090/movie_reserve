import { sql, type Kysely } from 'kysely';
import type { Database } from '../types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('sessions')
    .addColumn('id', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('user_id', 'uuid', (column) => column.notNull().references('users.id').onDelete('cascade'))
    .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('last_seen_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('sessions_user_id_idx')
    .on('sessions')
    .column('user_id')
    .execute();

  await db.schema
    .createIndex('sessions_expires_at_idx')
    .on('sessions')
    .column('expires_at')
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable('sessions').ifExists().execute();
}
