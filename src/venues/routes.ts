import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/database.js";

const fail = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

async function admin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!request.userId) {
    fail(reply, 401, "UNAUTHENTICATED", "A valid session is required");
    return false;
  }
  const user = await db.selectFrom("users").select("role")
    .where("id", "=", request.userId).where("status", "=", "ACTIVE").executeTakeFirst();
  if (user?.role !== "ADMIN") {
    fail(reply, 403, "FORBIDDEN", "Administrator access is required");
    return false;
  }
  return true;
}

interface TheaterBody { name: string; address: string; city: string; timezone?: string }
interface ScreenBody { theaterId: string; name: string; capacity: number }
interface SeatBody { screenId: string; rowLabel: string; seatNumber: number; seatType?: "REGULAR" | "PREMIUM" | "ACCESSIBLE" }

export async function registerVenueRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/theaters", {
    schema: { tags: ["Movies"], summary: "List active theaters" },
  }, async (request) => {
    const theaters = await db.selectFrom("theaters").selectAll()
      .where("status", "=", "ACTIVE").orderBy("name").execute();
    return { data: theaters, requestId: request.id };
  });

  app.get<{ Params: { theaterId: string } }>("/api/v1/theaters/:theaterId", {
    schema: { tags: ["Movies"], summary: "Get theater screens and seats" },
  }, async (request, reply) => {
    const theater = await db.selectFrom("theaters").selectAll()
      .where("id", "=", request.params.theaterId).where("status", "=", "ACTIVE").executeTakeFirst();
    if (!theater) return fail(reply, 404, "THEATER_NOT_FOUND", "Theater was not found");
    const screens = await db.selectFrom("screens").selectAll()
      .where("theater_id", "=", theater.id).orderBy("name").execute();
    const seats = screens.length
      ? await db.selectFrom("seats").selectAll().where("screen_id", "in", screens.map((screen) => screen.id))
        .where("is_active", "=", true).orderBy("row_label").orderBy("seat_number").execute()
      : [];
    return { data: { ...theater, screens: screens.map((screen) => ({ ...screen, seats: seats.filter((seat) => seat.screen_id === screen.id) })) }, requestId: request.id };
  });

  app.post<{ Body: TheaterBody }>("/api/v1/admin/theaters", {
    schema: { tags: ["Admin"], summary: "Create a theater" },
  }, async (request, reply) => {
    if (!(await admin(request, reply))) return;
    const theater = await db.insertInto("theaters").values({
      name: request.body.name.trim(), address: request.body.address.trim(),
      city: request.body.city.trim(), timezone: request.body.timezone ?? "UTC", status: "ACTIVE",
    }).returningAll().executeTakeFirstOrThrow();
    return reply.code(201).send({ data: theater, requestId: request.id });
  });

  app.post<{ Body: ScreenBody }>("/api/v1/admin/screens", {
    schema: { tags: ["Admin"], summary: "Create a screen in a theater" },
  }, async (request, reply) => {
    if (!(await admin(request, reply))) return;
    const theater = await db.selectFrom("theaters").select("id").where("id", "=", request.body.theaterId).executeTakeFirst();
    if (!theater) return fail(reply, 404, "THEATER_NOT_FOUND", "Theater was not found");
    const screen = await db.insertInto("screens").values({
      theater_id: request.body.theaterId, name: request.body.name.trim(), capacity: request.body.capacity,
    }).returningAll().executeTakeFirstOrThrow();
    return reply.code(201).send({ data: screen, requestId: request.id });
  });

  app.post<{ Body: SeatBody }>("/api/v1/admin/seats", {
    schema: { tags: ["Admin"], summary: "Create a seat in a screen" },
  }, async (request, reply) => {
    if (!(await admin(request, reply))) return;
    const screen = await db.selectFrom("screens").select("id").where("id", "=", request.body.screenId).executeTakeFirst();
    if (!screen) return fail(reply, 404, "SCREEN_NOT_FOUND", "Screen was not found");
    const seat = await db.insertInto("seats").values({
      screen_id: request.body.screenId, row_label: request.body.rowLabel.trim(),
      seat_number: request.body.seatNumber, seat_type: request.body.seatType ?? "REGULAR", is_active: true,
    }).returningAll().executeTakeFirstOrThrow();
    return reply.code(201).send({ data: seat, requestId: request.id });
  });
}
