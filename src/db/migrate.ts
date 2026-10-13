import { FileMigrationProvider, Migrator } from "kysely/migration";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, closeDatabase } from "./database.js";

const migrationsPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);
const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder: migrationsPath,
  }),
});

const { error, results } = await migrator.migrateToLatest();
for (const result of results ?? []) {
  console.log(`${result.status}: ${result.migrationName}`);
}
if (error) {
  console.error(error);
  process.exitCode = 1;
}
await closeDatabase();
