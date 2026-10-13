import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { env } from "./config/env.js";
import { closeDatabase } from "./db/database.js";
import { registerSessionAuth } from "./auth/session.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerSystemRoutes } from "./system/routes.js";
import { registerMovieRoutes } from "./movies/routes.js";
import { registerVenueRoutes } from "./venues/routes.js";
import { registerShowtimeRoutes } from "./showtimes/routes.js";
import { registerReservationRoutes } from "./reservations/routes.js";
import { registerReportRoutes } from "./reports/routes.js";
import { registerAdminRoutes } from "./admin/routes.js";

export function buildApp() {
  const app = Fastify({
    logger: {
      level: env.nodeEnv === "production" ? "info" : "debug",
    },
    requestIdHeader: "x-request-id",
  });

  app.register(cors, { origin: false });
  app.register(helmet);
  app.register(cookie);
  app.register(swagger, {
    openapi: {
      info: {
        title: "Movie Reservation API",
        description: "Backend API for movie discovery and seat reservations",
        version: "0.1.0",
      },
      servers: [
        {
          url: `http://localhost:${env.port}`,
          description: "Local development server",
        },
      ],
      tags: [
        { name: "System", description: "Service health and metadata" },
        { name: "Authentication", description: "Cookie-session authentication" },
        { name: "Movies", description: "Movie catalog operations" },
        { name: "Showtimes", description: "Showtime and seat operations" },
        { name: "Reservations", description: "Seat reservation operations" },
        { name: "Admin", description: "Administrator operations" },
      ],
    },
  });
  app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
    staticCSP: true,
  });
  registerSessionAuth(app);
  app.register(registerAuthRoutes);

  app.register(registerSystemRoutes);
  app.register(registerMovieRoutes);
  app.register(registerVenueRoutes);
  app.register(registerShowtimeRoutes);
  app.register(registerReservationRoutes);
  app.register(registerReportRoutes);
  app.register(registerAdminRoutes);

  app.addHook("onClose", async () => {
    await closeDatabase();
  });

  return app;
}
