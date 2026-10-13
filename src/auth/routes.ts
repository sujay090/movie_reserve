import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import argon2 from "argon2";
import { db } from "../db/database.js";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  setSessionCookie,
} from "./session.js";

interface CredentialsBody {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

const userResponse = (user: {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: "USER" | "ADMIN";
}) => ({
  id: user.id,
  email: user.email,
  firstName: user.first_name,
  lastName: user.last_name,
  role: user.role,
});

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const authError = (
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
) => reply.code(statusCode).send({ error: { code, message } });

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CredentialsBody }>(
    "/api/v1/auth/signup",
    {
      schema: {
        tags: ["Authentication"],
        summary: "Create a customer account",
        body: {
          type: "object",
          required: ["email", "password", "firstName", "lastName"],
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email", maxLength: 255 },
            password: { type: "string", minLength: 8, maxLength: 128 },
            firstName: { type: "string", minLength: 1, maxLength: 100 },
            lastName: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const email = normalizeEmail(request.body.email);
      const existing = await db
        .selectFrom("users")
        .select("id")
        .where("email", "=", email)
        .executeTakeFirst();
      if (existing)
        return authError(
          reply,
          409,
          "EMAIL_ALREADY_REGISTERED",
          "An account with this email already exists",
        );

      const passwordHash = await argon2.hash(request.body.password);
      const user = await db
        .insertInto("users")
        .values({
          email,
          password_hash: passwordHash,
          first_name: request.body.firstName!.trim(),
          last_name: request.body.lastName!.trim(),
          role: "USER",
          status: "ACTIVE",
        })
        .returning(["id", "email", "first_name", "last_name", "role"])
        .executeTakeFirstOrThrow();

      const sessionId = await createSession(user.id);
      setSessionCookie(reply, sessionId);
      return reply
        .code(201)
        .send({ data: { user: userResponse(user) }, requestId: request.id });
    },
  );

  app.post<{ Body: Pick<CredentialsBody, "email" | "password"> }>(
    "/api/v1/auth/login",
    {
      schema: {
        tags: ["Authentication"],
        summary: "Log in with email and password",
        body: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email", maxLength: 255 },
            password: { type: "string", minLength: 1, maxLength: 128 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await db
        .selectFrom("users")
        .select([
          "id",
          "email",
          "password_hash",
          "first_name",
          "last_name",
          "role",
          "status",
        ])
        .where("email", "=", normalizeEmail(request.body.email))
        .executeTakeFirst();

      if (
        !user ||
        user.status !== "ACTIVE" ||
        !(await argon2.verify(user.password_hash, request.body.password))
      ) {
        return authError(
          reply,
          401,
          "INVALID_CREDENTIALS",
          "Email or password is incorrect",
        );
      }

      const sessionId = await createSession(user.id);
      setSessionCookie(reply, sessionId);
      return reply.send({
        data: { user: userResponse(user) },
        requestId: request.id,
      });
    },
  );

  app.post(
    "/api/v1/auth/logout",
    {
      schema: {
        tags: ["Authentication"],
        summary: "Log out the current session",
      },
    },
    async (request, reply) => {
      const sessionId =
        request.cookies[process.env.SESSION_COOKIE_NAME ?? "movie_session"];
      if (sessionId) await destroySession(sessionId);
      clearSessionCookie(reply);
      return reply.send({ data: { loggedOut: true }, requestId: request.id });
    },
  );

  app.get(
    "/api/v1/users/me",
    {
      schema: {
        tags: ["Authentication"],
        summary: "Get the authenticated user",
      },
    },
    async (request: FastifyRequest, reply) => {
      if (!request.userId)
        return authError(
          reply,
          401,
          "UNAUTHENTICATED",
          "A valid session is required",
        );

      const user = await db
        .selectFrom("users")
        .select(["id", "email", "first_name", "last_name", "role", "status"])
        .where("id", "=", request.userId)
        .executeTakeFirst();

      if (!user || user.status !== "ACTIVE") {
        return authError(
          reply,
          401,
          "UNAUTHENTICATED",
          "A valid session is required",
        );
      }

      return reply.send({
        data: { user: userResponse(user) },
        requestId: request.id,
      });
    },
  );
}
