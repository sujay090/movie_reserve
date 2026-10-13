import { sql, type Kysely } from "kysely";
import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.createTable("reservations")
    .addColumn("id", "uuid", (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("reservation_code", "varchar(30)", (column) => column.notNull().unique())
    .addColumn("user_id", "uuid", (column) => column.notNull().references("users.id").onDelete("restrict"))
    .addColumn("showtime_id", "uuid", (column) => column.notNull().references("showtimes.id").onDelete("restrict"))
    .addColumn("status", "varchar(20)", (column) => column.notNull().defaultTo("CONFIRMED"))
    .addColumn("total_amount", "numeric(10, 2)", (column) => column.notNull())
    .addColumn("cancelled_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("reservations_status_check", sql`status IN ('CONFIRMED', 'CANCELLED', 'EXPIRED')`)
    .addCheckConstraint("reservations_amount_check", sql`total_amount >= 0`)
    .execute();

  await db.schema.createTable("reservation_seats")
    .addColumn("reservation_id", "uuid", (column) => column.notNull().references("reservations.id").onDelete("cascade"))
    .addColumn("seat_id", "uuid", (column) => column.notNull().references("seats.id").onDelete("restrict"))
    .addColumn("price", "numeric(10, 2)", (column) => column.notNull())
    .addPrimaryKeyConstraint("reservation_seats_pk", ["reservation_id", "seat_id"])
    .addCheckConstraint("reservation_seats_price_check", sql`price >= 0`)
    .execute();

  await db.schema.createTable("reservation_requests")
    .addColumn("idempotency_key", "varchar(255)", (column) => column.notNull())
    .addColumn("user_id", "uuid", (column) => column.notNull().references("users.id").onDelete("cascade"))
    .addColumn("reservation_id", "uuid", (column) => column.notNull().references("reservations.id").onDelete("cascade"))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("reservation_requests_pk", ["user_id", "idempotency_key"])
    .execute();

  await sql`ALTER TABLE showtime_seats ADD CONSTRAINT showtime_seats_reservation_fk
    FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL`.execute(db);
  await db.schema.createIndex("reservations_user_created_idx").on("reservations").columns(["user_id", "created_at"]).execute();
  await db.schema.createIndex("reservations_showtime_status_idx").on("reservations").columns(["showtime_id", "status"]).execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable("showtime_seats").dropConstraint("showtime_seats_reservation_fk").execute();
  await db.schema.dropTable("reservation_requests").ifExists().execute();
  await db.schema.dropTable("reservation_seats").ifExists().execute();
  await db.schema.dropTable("reservations").ifExists().execute();
}
