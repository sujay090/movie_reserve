import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/database.js";

const fail = (
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
) => reply.code(status).send({ error: { code, message } });

const requireUser = (request: FastifyRequest, reply: FastifyReply): boolean => {
  if (!request.userId) {
    fail(reply, 401, "UNAUTHENTICATED", "A valid session is required");
    return false;
  }
  return true;
};

const reservationCode = (): string =>
  `MOV-${randomBytes(5).toString("hex").toUpperCase()}`;

interface CreateReservationBody {
  seatIds: string[];
}
interface ShowtimeParams {
  showtimeId: string;
}
interface ReservationParams {
  reservationId: string;
}

async function reservationDetails(reservationId: string, userId?: string) {
  let query = db
    .selectFrom("reservations")
    .innerJoin("showtimes", "showtimes.id", "reservations.showtime_id")
    .innerJoin("movies", "movies.id", "showtimes.movie_id")
    .select([
      "reservations.id",
      "reservations.reservation_code",
      "reservations.user_id",
      "reservations.showtime_id",
      "reservations.status",
      "reservations.total_amount",
      "reservations.cancelled_at",
      "reservations.created_at",
      "showtimes.starts_at",
      "showtimes.ends_at",
      "movies.title as movie_title",
    ])
    .where("reservations.id", "=", reservationId);
  if (userId) query = query.where("reservations.user_id", "=", userId);
  const reservation = await query.executeTakeFirst();
  if (!reservation) return null;
  const seats = await db
    .selectFrom("reservation_seats")
    .innerJoin("seats", "seats.id", "reservation_seats.seat_id")
    .select([
      "reservation_seats.seat_id as id",
      "reservation_seats.price",
      "seats.row_label",
      "seats.seat_number",
      "seats.seat_type",
    ])
    .where("reservation_seats.reservation_id", "=", reservationId)
    .orderBy("seats.row_label")
    .orderBy("seats.seat_number")
    .execute();
  return { ...reservation, seats };
}

export async function registerReservationRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post<{ Params: ShowtimeParams; Body: CreateReservationBody }>(
    "/api/v1/showtimes/:showtimeId/reservations",
    {
      schema: {
        tags: ["Reservations"],
        summary: "Reserve seats for a showtime",
        headers: {
          type: "object",
          properties: {
            "idempotency-key": { type: "string", minLength: 8, maxLength: 255 },
          },
        },
        body: {
          type: "object",
          required: ["seatIds"],
          additionalProperties: false,
          properties: {
            seatIds: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              items: { type: "string", format: "uuid" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const seatIds = [...new Set(request.body.seatIds)];
      const idempotencyKey = request.headers["idempotency-key"];
      if (Array.isArray(idempotencyKey))
        return fail(
          reply,
          400,
          "INVALID_IDEMPOTENCY_KEY",
          "Only one Idempotency-Key is allowed",
        );
      if (idempotencyKey) {
        const previous = await db
          .selectFrom("reservation_requests")
          .select("reservation_id")
          .where("user_id", "=", request.userId!)
          .where("idempotency_key", "=", idempotencyKey)
          .executeTakeFirst();
        if (previous) {
          const existing = await reservationDetails(
            previous.reservation_id,
            request.userId!,
          );
          if (existing)
            return reply.send({ data: existing, requestId: request.id });
        }
      }

      try {
        const reservationId = await db.transaction().execute(async (trx) => {
          const showtime = await trx
            .selectFrom("showtimes")
            .select(["id", "starts_at", "ticket_price", "status"])
            .where("id", "=", request.params.showtimeId)
            .forUpdate()
            .executeTakeFirst();
          if (
            !showtime ||
            showtime.status !== "SCHEDULED" ||
            showtime.starts_at <= new Date()
          ) {
            throw new Error("SHOWTIME_NOT_BOOKABLE");
          }

          const seats = await trx
            .selectFrom("showtime_seats")
            .innerJoin("seats", "seats.id", "showtime_seats.seat_id")
            .select([
              "showtime_seats.seat_id",
              "showtime_seats.status",
              "seats.screen_id",
            ])
            .where("showtime_seats.showtime_id", "=", request.params.showtimeId)
            .where("showtime_seats.seat_id", "in", seatIds)
            .forUpdate()
            .execute();
          if (
            seats.length !== seatIds.length ||
            seats.some((seat) => seat.status !== "AVAILABLE")
          ) {
            throw new Error("SEAT_ALREADY_RESERVED");
          }

          const totalAmount = (
            Number(showtime.ticket_price) * seatIds.length
          ).toFixed(2);
          const created = await trx
            .insertInto("reservations")
            .values({
              reservation_code: reservationCode(),
              user_id: request.userId!,
              showtime_id: request.params.showtimeId,
              status: "CONFIRMED",
              total_amount: totalAmount,
              cancelled_at: null,
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          await trx
            .insertInto("reservation_seats")
            .values(
              seatIds.map((seatId) => ({
                reservation_id: created.id,
                seat_id: seatId,
                price: String(showtime.ticket_price),
              })),
            )
            .execute();
          await trx
            .updateTable("showtime_seats")
            .set({
              status: "RESERVED",
              reservation_id: created.id,
              reserved_at: new Date(),
            })
            .where("showtime_id", "=", request.params.showtimeId)
            .where("seat_id", "in", seatIds)
            .execute();
          if (idempotencyKey) {
            await trx
              .insertInto("reservation_requests")
              .values({
                idempotency_key: idempotencyKey,
                user_id: request.userId!,
                reservation_id: created.id,
              })
              .execute();
          }
          return created.id;
        });
        const result = await reservationDetails(reservationId, request.userId!);
        return reply.code(201).send({ data: result, requestId: request.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message === "SHOWTIME_NOT_BOOKABLE")
          return fail(
            reply,
            409,
            message,
            "Showtime is not available for booking",
          );
        if (message === "SEAT_ALREADY_RESERVED")
          return fail(
            reply,
            409,
            message,
            "One or more selected seats are no longer available",
          );
        request.log.error({ error }, "Reservation creation failed");
        return fail(
          reply,
          500,
          "RESERVATION_FAILED",
          "Reservation could not be created",
        );
      }
    },
  );

  app.get(
    "/api/v1/reservations/me",
    {
      schema: {
        tags: ["Reservations"],
        summary: "List the current user's reservations",
      },
    },
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const reservations = await db
        .selectFrom("reservations")
        .innerJoin("showtimes", "showtimes.id", "reservations.showtime_id")
        .innerJoin("movies", "movies.id", "showtimes.movie_id")
        .select([
          "reservations.id",
          "reservations.reservation_code",
          "reservations.status",
          "reservations.total_amount",
          "reservations.created_at",
          "showtimes.starts_at",
          "showtimes.ends_at",
          "movies.title as movie_title",
        ])
        .where("reservations.user_id", "=", request.userId!)
        .orderBy("reservations.created_at", "desc")
        .execute();
      return { data: reservations, requestId: request.id };
    },
  );

  app.get<{ Params: ReservationParams }>(
    "/api/v1/reservations/:reservationId",
    {
      schema: { tags: ["Reservations"], summary: "Get a reservation" },
    },
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const reservation = await reservationDetails(
        request.params.reservationId,
        request.userId!,
      );
      if (!reservation)
        return fail(
          reply,
          404,
          "RESERVATION_NOT_FOUND",
          "Reservation was not found",
        );
      return { data: reservation, requestId: request.id };
    },
  );

  app.post<{ Params: ReservationParams }>(
    "/api/v1/reservations/:reservationId/cancel",
    {
      schema: {
        tags: ["Reservations"],
        summary: "Cancel an upcoming reservation",
      },
    },
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const cancelled = await db.transaction().execute(async (trx) => {
        const reservation = await trx
          .selectFrom("reservations")
          .innerJoin("showtimes", "showtimes.id", "reservations.showtime_id")
          .select([
            "reservations.id",
            "reservations.status",
            "showtimes.starts_at",
          ])
          .where("reservations.id", "=", request.params.reservationId)
          .where("reservations.user_id", "=", request.userId!)
          .forUpdate()
          .executeTakeFirst();
        if (!reservation || reservation.status !== "CONFIRMED") return false;
        if (reservation.starts_at <= new Date())
          throw new Error("RESERVATION_NOT_UPCOMING");
        await trx
          .updateTable("reservations")
          .set({
            status: "CANCELLED",
            cancelled_at: new Date(),
            updated_at: new Date(),
          })
          .where("id", "=", reservation.id)
          .execute();
        await trx
          .updateTable("showtime_seats")
          .set({
            status: "AVAILABLE",
            reservation_id: null,
            reserved_at: null,
          })
          .where("reservation_id", "=", reservation.id)
          .execute();
        return true;
      });
      if (!cancelled)
        return fail(
          reply,
          404,
          "RESERVATION_NOT_FOUND",
          "Confirmed reservation was not found",
        );
      return {
        data: await reservationDetails(
          request.params.reservationId,
          request.userId!,
        ),
        requestId: request.id,
      };
    },
  );
}
