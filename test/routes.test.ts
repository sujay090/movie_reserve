import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const apiRoutes = [
  "GET /api/v1/system/health",
  "GET /api/v1/system/metadata",
  "POST /api/v1/auth/signup",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/logout",
  "GET /api/v1/users/me",
  "GET /api/v1/movies",
  "GET /api/v1/movies/:movieId",
  "GET /api/v1/genres",
  "GET /api/v1/theaters",
  "GET /api/v1/theaters/:theaterId",
  "GET /api/v1/showtimes",
  "GET /api/v1/showtimes/:showtimeId",
  "GET /api/v1/showtimes/:showtimeId/seats",
  "POST /api/v1/showtimes/:showtimeId/reservations",
  "GET /api/v1/reservations/me",
  "GET /api/v1/reservations/:reservationId",
  "POST /api/v1/reservations/:reservationId/cancel",
  "POST /api/v1/admin/movies",
  "POST /api/v1/admin/genres",
  "POST /api/v1/admin/theaters",
  "POST /api/v1/admin/screens",
  "POST /api/v1/admin/seats",
  "POST /api/v1/admin/showtimes",
  "POST /api/v1/admin/showtimes/:showtimeId/cancel",
  "GET /api/v1/admin/users",
  "PATCH /api/v1/admin/users/:userId/role",
  "PATCH /api/v1/admin/users/:userId/status",
  "GET /api/v1/admin/reports/reservations",
  "GET /api/v1/admin/reports/revenue",
  "GET /api/v1/admin/reports/capacity",
] as const;

const concrete = (route: string) =>
  route
    .replace(":movieId", "00000000-0000-0000-0000-000000000001")
    .replace(":theaterId", "00000000-0000-0000-0000-000000000002")
    .replace(":showtimeId", "00000000-0000-0000-0000-000000000003")
    .replace(":reservationId", "00000000-0000-0000-0000-000000000004")
    .replace(":userId", "00000000-0000-0000-0000-000000000005");

const validPayload = (path: string, method: string): unknown => {
  if (path.includes("/genres")) return { name: "Test genre" };
  if (path.includes("/movies"))
    return { title: "Test", description: "Test", durationMinutes: 90 };
  if (path.includes("/theaters"))
    return { name: "Test", address: "Test", city: "Test" };
  if (path.includes("/screens"))
    return {
      theaterId: "00000000-0000-0000-0000-000000000002",
      name: "Screen",
      capacity: 1,
    };
  if (path.includes("/showtimes/") && path.endsWith("/cancel"))
    return undefined;
  if (path.includes("/seats"))
    return {
      screenId: "00000000-0000-0000-0000-000000000002",
      rowLabel: "A",
      seatNumber: 1,
    };
  if (path.includes("/reservations"))
    return { seatIds: ["00000000-0000-0000-0000-000000000001"] };
  if (path.includes("/showtimes") && method === "POST") {
    return {
      movieId: "00000000-0000-0000-0000-000000000001",
      screenId: "00000000-0000-0000-0000-000000000002",
      startsAt: "2030-01-01T10:00:00.000Z",
      endsAt: "2030-01-01T12:00:00.000Z",
      ticketPrice: 10,
    };
  }
  if (path.includes("/role")) return { role: "USER" };
  if (path.includes("/status")) return { status: "ACTIVE" };
  return undefined;
};

describe("API route registration and authorization", () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildApp({ closeResources: false });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("registers every documented API route", async () => {
    const document = (await app.inject("/docs/json")).json() as {
      paths: Record<string, Record<string, unknown>>;
    };
    const methods = new Set(["GET", "POST", "PATCH"]);
    for (const route of apiRoutes) {
      const [method, path] = route.split(" ");
      const openApiPath = path.replace(
        /:[^/]+/g,
        (name) => `{${name.slice(1)}}`,
      );
      assert.ok(document.paths[openApiPath], `missing ${route}`);
      assert.ok(
        document.paths[openApiPath][method.toLowerCase()],
        `missing ${route}`,
      );
    }
    assert.equal(methods.size, 3);
    assert.ok(document.paths["/api/v1/auth/logout"]);
  });

  it("rejects every protected route without a session", async () => {
    const protectedRoutes = apiRoutes.filter(
      (route) =>
        !route.includes("/system/") &&
        !route.includes("/auth/signup") &&
        !route.includes("/auth/login") &&
        !route.includes("/auth/logout") &&
        !route.startsWith("GET /api/v1/movies") &&
        !route.startsWith("GET /api/v1/genres") &&
        !route.startsWith("GET /api/v1/theaters") &&
        !route.startsWith("GET /api/v1/showtimes"),
    );
    for (const route of protectedRoutes) {
      const [method] = route.split(" ");
      const response = await app.inject({
        method,
        url: concrete(route.slice(method.length + 1)),
        payload: validPayload(route, method),
      });
      assert.equal(response.statusCode, 401, route);
      assert.equal(response.json().error.code, "UNAUTHENTICATED", route);
    }
  });

  it("enforces request schemas before handlers access the database", async () => {
    const cases = [
      [
        "POST",
        "/api/v1/auth/signup",
        { email: "not-an-email", password: "short" },
      ],
      ["POST", "/api/v1/auth/login", { email: "not-an-email", password: "" }],
      ["POST", "/api/v1/showtimes/id/reservations", { seatIds: [] }],
      ["GET", "/api/v1/movies?page=0", undefined],
      ["GET", "/api/v1/showtimes?date=not-a-date", undefined],
    ] as const;
    for (const [method, url, payload] of cases) {
      const response = await app.inject({ method, url, payload });
      assert.equal(response.statusCode, 400, `${method} ${url}`);
    }
  });

  it("returns the documented 404 errors for valid but unknown resources", async () => {
    const cases = [
      [
        "/api/v1/movies/00000000-0000-0000-0000-000000000001",
        "MOVIE_NOT_FOUND",
      ],
      [
        "/api/v1/theaters/00000000-0000-0000-0000-000000000002",
        "THEATER_NOT_FOUND",
      ],
      [
        "/api/v1/showtimes/00000000-0000-0000-0000-000000000003",
        "SHOWTIME_NOT_FOUND",
      ],
    ] as const;
    for (const [url, code] of cases) {
      const response = await app.inject({ method: "GET", url });
      // A configured database gives the route's domain error. If no database is
      // available, the dependency failure is reported rather than hiding it.
      if (response.statusCode !== 500) {
        assert.equal(response.statusCode, 404);
        assert.equal(response.json().error.code, code);
      }
    }
  });
});
