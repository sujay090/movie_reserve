import { db, closeDatabase } from "./database.js";

const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
const passwordHash = process.env.ADMIN_PASSWORD_HASH;

if (!passwordHash) {
  console.error(
    "Set ADMIN_PASSWORD_HASH to a precomputed Argon2id or bcrypt hash.",
  );
  process.exitCode = 1;
} else {
  await db
    .insertInto("users")
    .values({
      email,
      password_hash: passwordHash,
      first_name: "System",
      last_name: "Admin",
      role: "ADMIN",
      status: "ACTIVE",
    })
    .onConflict((oc) => oc.column("email").doNothing())
    .execute();
}

await closeDatabase();
