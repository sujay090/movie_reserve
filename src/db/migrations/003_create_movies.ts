import { sql, type Kysely } from "kysely";
import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("genres")
    .addColumn("id", "uuid", (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", "varchar(100)", (column) => column.notNull().unique())
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("movies")
    .addColumn("id", "uuid", (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("title", "varchar(255)", (column) => column.notNull())
    .addColumn("description", "text", (column) => column.notNull())
    .addColumn("poster_url", "text")
    .addColumn("duration_minutes", "integer", (column) => column.notNull())
    .addColumn("release_date", "date")
    .addColumn("age_rating", "varchar(20)")
    .addColumn("status", "varchar(20)", (column) => column.notNull().defaultTo("ACTIVE"))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("movies_duration_check", sql`duration_minutes > 0`)
    .addCheckConstraint("movies_status_check", sql`status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')`)
    .execute();

  await db.schema
    .createTable("movie_genres")
    .addColumn("movie_id", "uuid", (column) => column.notNull().references("movies.id").onDelete("cascade"))
    .addColumn("genre_id", "uuid", (column) => column.notNull().references("genres.id").onDelete("restrict"))
    .addPrimaryKeyConstraint("movie_genres_pk", ["movie_id", "genre_id"])
    .execute();

  await db.schema.createIndex("movies_status_idx").on("movies").column("status").execute();
  await db.schema.createIndex("movies_title_idx").on("movies").column("title").execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("movie_genres").ifExists().execute();
  await db.schema.dropTable("movies").ifExists().execute();
  await db.schema.dropTable("genres").ifExists().execute();
}
