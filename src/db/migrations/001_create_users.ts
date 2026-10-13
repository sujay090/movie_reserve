import { sql, type Kysely } from 'kysely';
import type { Database } from '../types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'varchar(255)', (column) => column.notNull().unique())
    .addColumn('password_hash', 'text', (column) => column.notNull())
    .addColumn('first_name', 'varchar(100)', (column) => column.notNull())
    .addColumn('last_name', 'varchar(100)', (column) => column.notNull())
    .addColumn('role', 'varchar(20)', (column) => column.notNull().defaultTo('USER'))
    .addColumn('status', 'varchar(20)', (column) => column.notNull().defaultTo('ACTIVE'))
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('users_role_check', sql`role IN ('USER', 'ADMIN')`)
    .addCheckConstraint('users_status_check', sql`status IN ('ACTIVE', 'SUSPENDED', 'DELETED')`)
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable('users').ifExists().execute();
}
