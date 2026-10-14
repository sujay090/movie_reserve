import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

describe("system API", () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("returns service metadata", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/system/metadata",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: {
        service: string;
        version: string;
        environment: string;
        docsPath: string;
      };
      requestId: string;
    };
    assert.equal(body.data.service, "movie-reservation-api");
    assert.equal(body.data.version, "0.1.0");
    assert.ok(body.data.environment);
    assert.equal(body.data.docsPath, "/docs");
    assert.ok(body.requestId);
  });

  it("serves the OpenAPI document", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/docs/json",
    });

    assert.equal(response.statusCode, 200);
    const document = response.json() as {
      openapi: string;
      info: { title: string };
      paths: Record<string, unknown>;
    };
    assert.equal(document.openapi, "3.0.3");
    assert.equal(document.info.title, "Movie Reservation API");
    assert.ok(document.paths["/api/v1/auth/login"]);
    assert.ok(document.paths["/api/v1/showtimes/{showtimeId}/reservations"]);
  });

  it("requires a session for reservation history", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/reservations/me",
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "UNAUTHENTICATED");
  });
});
