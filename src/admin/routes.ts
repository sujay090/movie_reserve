import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/database.js";

const fail = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!request.userId) {
    fail(reply, 401, "UNAUTHENTICATED", "A valid session is required");
    return false;
  }

  const user = await db.selectFrom("users")
    .select("role")
    .where("id", "=", request.userId)
    .where("status", "=", "ACTIVE")
    .executeTakeFirst();

  if (user?.role !== "ADMIN") {
    fail(reply, 403, "FORBIDDEN", "Administrator access is required");
    return false;
  }
  return true;
}

interface UserQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: "ACTIVE" | "SUSPENDED" | "DELETED";
  role?: "USER" | "ADMIN";
}

interface UserParams {
  userId: string;
}

interface RoleBody {
  role: "USER" | "ADMIN";
}

interface StatusBody {
  status: "ACTIVE" | "SUSPENDED";
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: UserQuery }>("/api/v1/admin/users", {
    schema: {
      tags: ["Admin"],
      summary: "List users",
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1 },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          search: { type: "string", maxLength: 100 },
          status: { type: "string", enum: ["ACTIVE", "SUSPENDED", "DELETED"] },
          role: { type: "string", enum: ["USER", "ADMIN"] },
        },
      },
    },
  }, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const page = request.query.page ?? 1;
    const limit = request.query.limit ?? 20;
    let query = db.selectFrom("users")
      .select(["id", "email", "first_name", "last_name", "role", "status", "created_at", "updated_at"])
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset((page - 1) * limit);

    if (request.query.status) query = query.where("status", "=", request.query.status);
    if (request.query.role) query = query.where("role", "=", request.query.role);
    if (request.query.search) {
      const search = `%${request.query.search}%`;
      query = query.where((eb) => eb.or([
        eb("email", "ilike", search),
        eb("first_name", "ilike", search),
        eb("last_name", "ilike", search),
      ]));
    }

    let countQuery = db.selectFrom("users")
      .select(({ fn }) => fn.countAll<number>().as("count"));
    if (request.query.status) countQuery = countQuery.where("status", "=", request.query.status);
    if (request.query.role) countQuery = countQuery.where("role", "=", request.query.role);
    if (request.query.search) {
      const search = `%${request.query.search}%`;
      countQuery = countQuery.where((eb) => eb.or([
        eb("email", "ilike", search),
        eb("first_name", "ilike", search),
        eb("last_name", "ilike", search),
      ]));
    }

    const [items, count] = await Promise.all([query.execute(), countQuery.executeTakeFirstOrThrow()]);

    return {
      data: { items, page, limit, total: Number(count.count) },
      requestId: request.id,
    };
  });

  app.patch<{ Params: UserParams; Body: RoleBody }>("/api/v1/admin/users/:userId/role", {
    schema: {
      tags: ["Admin"],
      summary: "Change a user's role",
      body: {
        type: "object",
        required: ["role"],
        additionalProperties: false,
        properties: { role: { type: "string", enum: ["USER", "ADMIN"] } },
      },
    },
  }, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    if (request.params.userId === request.userId && request.body.role === "USER") {
      return fail(reply, 400, "SELF_DEMOTION_NOT_ALLOWED", "An administrator cannot remove their own admin role");
    }

    const user = await db.updateTable("users")
      .set({ role: request.body.role, updated_at: new Date() })
      .where("id", "=", request.params.userId)
      .where("status", "!=", "DELETED")
      .returning(["id", "email", "first_name", "last_name", "role", "status"])
      .executeTakeFirst();
    if (!user) return fail(reply, 404, "USER_NOT_FOUND", "User was not found");
    return { data: { user }, requestId: request.id };
  });

  app.patch<{ Params: UserParams; Body: StatusBody }>("/api/v1/admin/users/:userId/status", {
    schema: {
      tags: ["Admin"],
      summary: "Suspend or reactivate a user",
      body: {
        type: "object",
        required: ["status"],
        additionalProperties: false,
        properties: { status: { type: "string", enum: ["ACTIVE", "SUSPENDED"] } },
      },
    },
  }, async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    if (request.params.userId === request.userId && request.body.status === "SUSPENDED") {
      return fail(reply, 400, "SELF_SUSPENSION_NOT_ALLOWED", "An administrator cannot suspend their own account");
    }

    const user = await db.updateTable("users")
      .set({ status: request.body.status, updated_at: new Date() })
      .where("id", "=", request.params.userId)
      .where("status", "!=", "DELETED")
      .returning(["id", "email", "first_name", "last_name", "role", "status"])
      .executeTakeFirst();
    if (!user) return fail(reply, 404, "USER_NOT_FOUND", "User was not found");

    if (request.body.status === "SUSPENDED") {
      await db.deleteFrom("sessions").where("user_id", "=", user.id).execute();
    }

    return { data: { user }, requestId: request.id };
  });
}
