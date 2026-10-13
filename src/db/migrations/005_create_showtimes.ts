import { sql, type Kysely } from "kysely";
import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS btree_gist`.execute(db);

  await db.schema.createTable("showtimes")
    .addColumn("id", "uuid", (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("movie_id", "uuid", (column) => column.notNull().references("movies.id").onDelete("restrict"))
    .addColumn("screen_id", "uuid", (column) => column.notNull().references("screens.id").onDelete("restrict"))
    .addColumn("starts_at", "timestamptz", (column) => column.notNull())
    .addColumn("ends_at", "timestamptz", (column) => column.notNull())
    .addColumn("ticket_price", "numeric(10, 2)", (column) => column.notNull())
    .addColumn("status", "varchar(20)", (column) => column.notNull().defaultTo("SCHEDULED"))
    .addColumn("created_by", "uuid", (column) => column.references("users.id").onDelete("set null"))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("showtimes_time_check", sql`ends_at > starts_at`)
    .addCheckConstraint("showtimes_price_check", sql`ticket_price >= 0`)
    .addCheckConstraint("showtimes_status_check", sql`status IN ('SCHEDULED', 'CANCELLED', 'COMPLETED')`)
    .execute();

  await sql`
    ALTER TABLE showtimes
    ADD CONSTRAINT no_overlapping_showtimes
    EXCLUDE USING gist (
      screen_id WITH =,
      tstzrange(starts_at, ends_at, '[)') WITH &&
    )
    WHERE (status = 'SCHEDULED')
  `.execute(db);

  await db.schema.createTable("showtime_seats")
    .addColumn("showtime_id", "uuid", (column) => column.notNull().references("showtimes.id").onDelete("cascade"))
    .addColumn("seat_id", "uuid", (column) => column.notNull().references("seats.id").onDelete("restrict"))
    .addColumn("status", "varchar(20)", (column) => column.notNull().defaultTo("AVAILABLE"))
    .addColumn("reservation_id", "uuid")
    .addColumn("reserved_at", "timestamptz")
    .addPrimaryKeyConstraint("showtime_seats_pk", ["showtime_id", "seat_id"])
    .addCheckConstraint("showtime_seats_status_check", sql`status IN ('AVAILABLE', 'RESERVED')`)
    .execute();

  await db.schema.createIndex("showtimes_movie_date_idx").on("showtimes").columns(["movie_id", "starts_at"]).execute();
  await db.schema.createIndex("showtimes_screen_date_idx").on("showtimes").columns(["screen_id", "starts_at"]).execute();
  await db.schema.createIndex("showtime_seats_status_idx").on("showtime_seats").columns(["showtime_id", "status"]).execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("showtime_seats").ifExists().execute();
  await db.schema.dropTable("showtimes").ifExists().execute();
}
