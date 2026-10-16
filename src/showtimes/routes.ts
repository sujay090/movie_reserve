import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sql } from "kysely";
import { db } from "../db/database.js";

const fail = (
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
) => reply.code(status).send({ error: { code, message } });

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (!request.userId) {
    fail(reply, 401, "UNAUTHENTICATED", "A valid session is required");
    return false;
  }
  const user = await db
    .selectFrom("users")
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

interface ShowtimeBody {
  movieId: string;
  screenId: string;
  startsAt: string;
  endsAt: string;
  ticketPrice: number;
}

interface ShowtimesQuery {
  date?: string;
  movieId?: string;
  theaterId?: string;
}

async function showtimeDetails(showtimeId: string) {
  return db
    .selectFrom("showtimes")
    .innerJoin("movies", "movies.id", "showtimes.movie_id")
    .innerJoin("screens", "screens.id", "showtimes.screen_id")
    .innerJoin("theaters", "theaters.id", "screens.theater_id")
    .select([
      "showtimes.id",
      "showtimes.movie_id",
      "showtimes.screen_id",
      "showtimes.starts_at",
      "showtimes.ends_at",
      "showtimes.ticket_price",
      "showtimes.status",
      "movies.title as movie_title",
      "screens.name as screen_name",
      "theaters.id as theater_id",
      "theaters.name as theater_name",
      "theaters.city as theater_city",
    ])
    .where("showtimes.id", "=", showtimeId)
    .executeTakeFirst();
}

export async function registerShowtimeRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Querystring: ShowtimesQuery }>(
    "/api/v1/showtimes",
    {
      schema: {
        tags: ["Showtimes"],
        summary: "List scheduled showtimes",
        querystring: {
          type: "object",
          properties: {
            date: { type: "string", format: "date" },
            movieId: { type: "string", format: "uuid" },
            theaterId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      let query = db
        .selectFrom("showtimes")
        .innerJoin("movies", "movies.id", "showtimes.movie_id")
        .innerJoin("screens", "screens.id", "showtimes.screen_id")
        .innerJoin("theaters", "theaters.id", "screens.theater_id")
        .select([
          "showtimes.id",
          "showtimes.movie_id",
          "showtimes.screen_id",
          "showtimes.starts_at",
          "showtimes.ends_at",
          "showtimes.ticket_price",
          "showtimes.status",
          "movies.title as movie_title",
          "screens.name as screen_name",
          "theaters.id as theater_id",
          "theaters.name as theater_name",
          "theaters.city as theater_city",
        ])
        .where("showtimes.status", "=", "SCHEDULED")
        .where("movies.status", "=", "ACTIVE")
        .where("showtimes.starts_at", ">", new Date())
        .orderBy("showtimes.starts_at");

      if (request.query.movieId)
        query = query.where("showtimes.movie_id", "=", request.query.movieId);
      if (request.query.theaterId)
        query = query.where("theaters.id", "=", request.query.theaterId);
      if (request.query.date) {
        const start = new Date(`${request.query.date}T00:00:00.000Z`);
        const end = new Date(`${request.query.date}T23:59:59.999Z`);
        if (Number.isNaN(start.getTime()))
          return fail(reply, 400, "INVALID_DATE", "Date must use YYYY-MM-DD");
        query = query
          .where("showtimes.starts_at", ">=", start)
          .where("showtimes.starts_at", "<=", end);
      }

      return { data: await query.execute(), requestId: request.id };
    },
  );

  app.get<{ Params: { showtimeId: string } }>(
    "/api/v1/showtimes/:showtimeId",
    {
      schema: { tags: ["Showtimes"], summary: "Get showtime details" },
    },
    async (request, reply) => {
      const showtime = await showtimeDetails(request.params.showtimeId);
      if (!showtime)
        return fail(reply, 404, "SHOWTIME_NOT_FOUND", "Showtime was not found");
      return { data: showtime, requestId: request.id };
    },
  );

  app.get<{ Params: { showtimeId: string } }>(
    "/api/v1/showtimes/:showtimeId/seats",
    {
      schema: {
        tags: ["Showtimes"],
        summary: "Get seat availability for a showtime",
      },
    },
    async (request, reply) => {
      const showtime = await showtimeDetails(request.params.showtimeId);
      if (!showtime)
        return fail(reply, 404, "SHOWTIME_NOT_FOUND", "Showtime was not found");
      const seats = await db
        .selectFrom("showtime_seats")
        .innerJoin("seats", "seats.id", "showtime_seats.seat_id")
        .select([
          "showtime_seats.seat_id as id",
          "showtime_seats.status",
          "seats.row_label",
          "seats.seat_number",
          "seats.seat_type",
        ])
        .where("showtime_seats.showtime_id", "=", request.params.showtimeId)
        .where("seats.is_active", "=", true)
        .orderBy("seats.row_label")
        .orderBy("seats.seat_number")
        .execute();
      return { data: { showtime, seats }, requestId: request.id };
    },
  );

  app.post<{ Body: ShowtimeBody }>(
    "/api/v1/admin/showtimes",
    {
      schema: { tags: ["Admin"], summary: "Create a showtime" },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const startsAt = new Date(request.body.startsAt);
      const endsAt = new Date(request.body.endsAt);
      if (
        Number.isNaN(startsAt.getTime()) ||
        Number.isNaN(endsAt.getTime()) ||
        endsAt <= startsAt
      ) {
        return fail(
          reply,
          400,
          "INVALID_TIME_RANGE",
          "endsAt must be later than startsAt",
        );
      }

      const [movie, screen] = await Promise.all([
        db
          .selectFrom("movies")
          .select("id")
          .where("id", "=", request.body.movieId)
          .where("status", "=", "ACTIVE")
          .executeTakeFirst(),
        db
          .selectFrom("screens")
          .select("id")
          .where("id", "=", request.body.screenId)
          .executeTakeFirst(),
      ]);
      if (!movie)
        return fail(
          reply,
          404,
          "MOVIE_NOT_FOUND",
          "Active movie was not found",
        );
      if (!screen)
        return fail(reply, 404, "SCREEN_NOT_FOUND", "Screen was not found");

      try {
        const showtime = await db.transaction().execute(async (trx) => {
          const created = await trx
            .insertInto("showtimes")
            .values({
              movie_id: request.body.movieId,
              screen_id: request.body.screenId,
              starts_at: startsAt,
              ends_at: endsAt,
              ticket_price: String(request.body.ticketPrice),
              status: "SCHEDULED",
              created_by: request.userId!,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          await trx
            .insertInto("showtime_seats")
            .columns(["showtime_id", "seat_id"])
            .expression((eb) =>
              eb
                .selectFrom("seats")
                .select(({ ref }) => [
                  eb.val(created.id).as("showtime_id"),
                  ref("seats.id").as("seat_id"),
                ])
                .where("screen_id", "=", request.body.screenId)
                .where("is_active", "=", true),
            )
            .execute();
          return created;
        });
        return reply.code(201).send({
          data: await showtimeDetails(showtime.id),
          requestId: request.id,
        });
      } catch (error) {
        request.log.warn({ error }, "Showtime creation failed");
        return fail(
          reply,
          409,
          "SHOWTIME_CONFLICT",
          "The screen has an overlapping scheduled showtime",
        );
      }
    },
  );

  app.post<{ Params: { showtimeId: string } }>(
    "/api/v1/admin/showtimes/:showtimeId/cancel",
    {
      schema: { tags: ["Admin"], summary: "Cancel a showtime" },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const updated = await db
        .updateTable("showtimes")
        .set({ status: "CANCELLED", updated_at: new Date() })
        .where("id", "=", request.params.showtimeId)
        .where("status", "=", "SCHEDULED")
        .returning("id")
        .executeTakeFirst();
      if (!updated)
        return fail(
          reply,
          404,
          "SHOWTIME_NOT_FOUND",
          "Scheduled showtime was not found",
        );
      return { data: await showtimeDetails(updated.id), requestId: request.id };
    },
  );
}
