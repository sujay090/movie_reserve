import { sql, type Kysely } from "kysely";
import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.createTable("theaters")
    .addColumn("id", "uuid", (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", "varchar(255)", (column) => column.notNull())
    .addColumn("address", "text", (column) => column.notNull())
    .addColumn("city", "varchar(100)", (column) => column.notNull())
    .addColumn("timezone", "varchar(100)", (column) => column.notNull().defaultTo("UTC"))
    .addColumn("status", "varchar(20)", (column) => column.notNull().defaultTo("ACTIVE"))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("theaters_status_check", sql`status IN ('ACTIVE', 'INACTIVE')`)
    .execute();

  await db.schema.createTable("screens")
    .addColumn("id", "uuid", (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("theater_id", "uuid", (column) => column.notNull().references("theaters.id").onDelete("restrict"))
    .addColumn("name", "varchar(100)", (column) => column.notNull())
    .addColumn("capacity", "integer", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("screens_theater_name_unique", ["theater_id", "name"])
    .addCheckConstraint("screens_capacity_check", sql`capacity > 0`)
    .execute();

  await db.schema.createTable("seats")
    .addColumn("id", "uuid", (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("screen_id", "uuid", (column) => column.notNull().references("screens.id").onDelete("cascade"))
    .addColumn("row_label", "varchar(10)", (column) => column.notNull())
    .addColumn("seat_number", "integer", (column) => column.notNull())
    .addColumn("seat_type", "varchar(20)", (column) => column.notNull().defaultTo("REGULAR"))
    .addColumn("is_active", "boolean", (column) => column.notNull().defaultTo(true))
    .addUniqueConstraint("seats_screen_position_unique", ["screen_id", "row_label", "seat_number"])
    .addCheckConstraint("seats_number_check", sql`seat_number > 0`)
    .addCheckConstraint("seats_type_check", sql`seat_type IN ('REGULAR', 'PREMIUM', 'ACCESSIBLE')`)
    .execute();

  await db.schema.createIndex("screens_theater_idx").on("screens").column("theater_id").execute();
  await db.schema.createIndex("seats_screen_idx").on("seats").column("screen_id").execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("seats").ifExists().execute();
  await db.schema.dropTable("screens").ifExists().execute();
  await db.schema.dropTable("theaters").ifExists().execute();
}
