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

interface ReportQuery {
  from?: string;
  to?: string;
  movieId?: string;
  theaterId?: string;
}

function parseDateRange(query: ReportQuery): { from: Date; to: Date } | null {
  const from = query.from
    ? new Date(`${query.from}T00:00:00.000Z`)
    : new Date(0);
  const to = query.to
    ? new Date(`${query.to}T00:00:00.000Z`)
    : new Date("9999-12-31T23:59:59.999Z");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to)
    return null;
  return { from, to };
}

function reportQuerySchema() {
  return {
    type: "object",
    properties: {
      from: {
        type: "string",
        format: "date",
        description: "Inclusive UTC date",
      },
      to: { type: "string", format: "date", description: "Exclusive UTC date" },
      movieId: { type: "string", format: "uuid" },
      theaterId: { type: "string", format: "uuid" },
    },
  };
}

export async function registerReportRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Querystring: ReportQuery }>(
    "/api/v1/admin/reports/reservations",
    {
      schema: {
        tags: ["Admin"],
        summary: "Get reservation summary",
        querystring: reportQuerySchema(),
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const range = parseDateRange(request.query);
      if (!range)
        return fail(
          reply,
          400,
          "INVALID_DATE_RANGE",
          "from and to must be valid dates with from before to",
        );

      let query = db
        .selectFrom("reservations")
        .innerJoin("showtimes", "showtimes.id", "reservations.showtime_id")
        .innerJoin("movies", "movies.id", "showtimes.movie_id")
        .innerJoin("screens", "screens.id", "showtimes.screen_id")
        .select(["reservations.status", sql<number>`count(*)`.as("count")])
        .where("reservations.created_at", ">=", range.from)
        .where("reservations.created_at", "<", range.to)
        .groupBy("reservations.status");

      if (request.query.movieId)
        query = query.where("movies.id", "=", request.query.movieId);
      if (request.query.theaterId)
        query = query.where("screens.theater_id", "=", request.query.theaterId);

      const rows = await query.execute();
      const summary = {
        confirmed: 0,
        cancelled: 0,
        expired: 0,
        total: 0,
      };
      for (const row of rows) {
        const count = Number(row.count);
        summary[
          row.status.toLowerCase() as "confirmed" | "cancelled" | "expired"
        ] = count;
        summary.total += count;
      }
      return { data: { range: request.query, summary }, requestId: request.id };
    },
  );

  app.get<{ Querystring: ReportQuery }>(
    "/api/v1/admin/reports/revenue",
    {
      schema: {
        tags: ["Admin"],
        summary: "Get revenue summary",
        querystring: reportQuerySchema(),
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const range = parseDateRange(request.query);
      if (!range)
        return fail(
          reply,
          400,
          "INVALID_DATE_RANGE",
          "from and to must be valid dates with from before to",
        );

      let query = db
        .selectFrom("reservations")
        .innerJoin("showtimes", "showtimes.id", "reservations.showtime_id")
        .innerJoin("movies", "movies.id", "showtimes.movie_id")
        .innerJoin("screens", "screens.id", "showtimes.screen_id")
        .select([
          sql<number>`count(*)`.as("reservation_count"),
          sql<string>`coalesce(sum(reservations.total_amount), 0)`.as(
            "revenue",
          ),
        ])
        .where("reservations.status", "=", "CONFIRMED")
        .where("reservations.created_at", ">=", range.from)
        .where("reservations.created_at", "<", range.to);

      if (request.query.movieId)
        query = query.where("movies.id", "=", request.query.movieId);
      if (request.query.theaterId)
        query = query.where("screens.theater_id", "=", request.query.theaterId);

      const result = await query.executeTakeFirstOrThrow();
      return {
        data: {
          range: request.query,
          reservationCount: Number(result.reservation_count),
          revenue: Number(result.revenue),
        },
        requestId: request.id,
      };
    },
  );

  app.get<{ Querystring: ReportQuery }>(
    "/api/v1/admin/reports/capacity",
    {
      schema: {
        tags: ["Admin"],
        summary: "Get showtime capacity and occupancy",
        querystring: reportQuerySchema(),
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      const range = parseDateRange(request.query);
      if (!range)
        return fail(
          reply,
          400,
          "INVALID_DATE_RANGE",
          "from and to must be valid dates with from before to",
        );

      let query = db
        .selectFrom("showtimes")
        .innerJoin("movies", "movies.id", "showtimes.movie_id")
        .innerJoin("screens", "screens.id", "showtimes.screen_id")
        .innerJoin("theaters", "theaters.id", "screens.theater_id")
        .innerJoin(
          "showtime_seats",
          "showtime_seats.showtime_id",
          "showtimes.id",
        )
        .select([
          "showtimes.id as showtime_id",
          "showtimes.starts_at",
          "movies.title as movie_title",
          "theaters.name as theater_name",
          "screens.name as screen_name",
          sql<number>`count(showtime_seats.seat_id)`.as("capacity"),
          sql<number>`count(showtime_seats.seat_id) filter (where showtime_seats.status = 'RESERVED')`.as(
            "reserved_seats",
          ),
        ])
        .where("showtimes.starts_at", ">=", range.from)
        .where("showtimes.starts_at", "<", range.to)
        .groupBy([
          "showtimes.id",
          "showtimes.starts_at",
          "movies.title",
          "theaters.name",
          "screens.name",
        ])
        .orderBy("showtimes.starts_at");

      if (request.query.movieId)
        query = query.where("movies.id", "=", request.query.movieId);
      if (request.query.theaterId)
        query = query.where("theaters.id", "=", request.query.theaterId);

      const rows = await query.execute();
      const showtimes = rows.map((row) => {
        const capacity = Number(row.capacity);
        const reservedSeats = Number(row.reserved_seats);
        return {
          showtimeId: row.showtime_id,
          startsAt: row.starts_at,
          movieTitle: row.movie_title,
          theaterName: row.theater_name,
          screenName: row.screen_name,
          capacity,
          reservedSeats,
          availableSeats: capacity - reservedSeats,
          occupancyPercentage:
            capacity === 0
              ? 0
              : Number(((reservedSeats / capacity) * 100).toFixed(2)),
        };
      });

      return {
        data: { range: request.query, showtimes },
        requestId: request.id,
      };
    },
  );
}
