import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { env } from "../config/env.js";
import { db } from "../db/database.js";
import { closeRedis, pingRedis } from "../cache/redis.js";

const serviceVersion = "0.1.0";

type DependencyStatus = "up" | "down";

async function checkDatabase(): Promise<DependencyStatus> {
  try {
    await sql`SELECT 1`.execute(db);
    return "up";
  } catch {
    return "down";
  }
}

async function checkRedis(): Promise<DependencyStatus> {
  try {
    return (await pingRedis()) ? "up" : "down";
  } catch {
    return "down";
  }
}

const dependencySchema = {
  type: "object",
  required: ["database", "redis"],
  properties: {
    database: { type: "string", enum: ["up", "down"] },
    redis: { type: "string", enum: ["up", "down"] },
  },
} as const;

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", {
    schema: {
      tags: ["System"],
      summary: "Check API and dependency health",
      response: {
        200: {
          type: "object",
          required: ["data", "requestId"],
          properties: {
            data: {
              type: "object",
              required: ["status", "dependencies"],
              properties: {
                status: { type: "string", enum: ["ok", "degraded"] },
                dependencies: dependencySchema,
              },
            },
            requestId: { type: "string" },
          },
        },
        503: {
          type: "object",
          required: ["data", "requestId"],
          properties: {
            data: {
              type: "object",
              required: ["status", "dependencies"],
              properties: {
                status: { type: "string", enum: ["ok", "degraded"] },
                dependencies: dependencySchema,
              },
            },
            requestId: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
    const status = database === "up" && redis === "up" ? "ok" : "degraded";
    const response = {
      data: { status, dependencies: { database, redis } },
      requestId: request.id,
    };

    return reply.code(status === "ok" ? 200 : 503).send(response);
  });

  app.get("/api/v1/system/health", {
    schema: {
      tags: ["System"],
      summary: "Check API and dependency health",
      response: {
        200: {
          type: "object",
          required: ["data", "requestId"],
          properties: {
            data: {
              type: "object",
              required: ["status", "dependencies"],
              properties: {
                status: { type: "string", enum: ["ok", "degraded"] },
                dependencies: dependencySchema,
              },
            },
            requestId: { type: "string" },
          },
        },
        503: {
          type: "object",
          required: ["data", "requestId"],
          properties: {
            data: {
              type: "object",
              required: ["status", "dependencies"],
              properties: {
                status: { type: "string", enum: ["ok", "degraded"] },
                dependencies: dependencySchema,
              },
            },
            requestId: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
    const status = database === "up" && redis === "up" ? "ok" : "degraded";
    return reply.code(status === "ok" ? 200 : 503).send({
      data: { status, dependencies: { database, redis } },
      requestId: request.id,
    });
  });

  app.get("/api/v1/system/metadata", {
    schema: {
      tags: ["System"],
      summary: "Get service metadata",
      response: {
        200: {
          type: "object",
          required: ["data", "requestId"],
          properties: {
            data: {
              type: "object",
              required: ["service", "version", "environment", "uptimeSeconds", "nodeVersion", "docsPath"],
              properties: {
                service: { type: "string" },
                version: { type: "string" },
                environment: { type: "string" },
                uptimeSeconds: { type: "number" },
                nodeVersion: { type: "string" },
                docsPath: { type: "string" },
              },
            },
            requestId: { type: "string" },
          },
        },
      },
    },
  }, async (request) => ({
    data: {
      service: "movie-reservation-api",
      version: serviceVersion,
      environment: env.nodeEnv,
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      docsPath: "/docs",
    },
    requestId: request.id,
  }));

  app.addHook("onClose", async () => {
    await closeRedis();
  });
}
