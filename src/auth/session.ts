import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/database.js";
import { env } from "../config/env.js";

const hashSessionId = (sessionId: string): string =>
  createHash("sha256").update(sessionId).digest("hex");

export async function createSession(userId: string): Promise<string> {
  const sessionId = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + env.sessionTtlDays * 24 * 60 * 60 * 1000,
  );

  await db
    .insertInto("sessions")
    .values({
      id: hashSessionId(sessionId),
      user_id: userId,
      expires_at: expiresAt,
      created_at: now,
      last_seen_at: now,
    })
    .execute();

  return sessionId;
}

export async function destroySession(sessionId: string): Promise<void> {
  await db
    .deleteFrom("sessions")
    .where("id", "=", hashSessionId(sessionId))
    .execute();
}

export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(env.sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    path: "/",
    maxAge: env.sessionTtlDays * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(env.sessionCookieName, { path: "/" });
}

export function registerSessionAuth(app: FastifyInstance): void {
  app.decorateRequest("userId", null);
  app.addHook("onRequest", async (request: FastifyRequest) => {
    const sessionId = request.cookies[env.sessionCookieName];
    if (!sessionId) return;

    const session = await db
      .selectFrom("sessions")
      .select(["user_id", "expires_at"])
      .where("id", "=", hashSessionId(sessionId))
      .executeTakeFirst();

    if (!session || session.expires_at <= new Date()) {
      await destroySession(sessionId);
      return;
    }

    request.userId = session.user_id;
    await db
      .updateTable("sessions")
      .set({ last_seen_at: new Date() })
      .where("id", "=", hashSessionId(sessionId))
      .execute();
  });
}
