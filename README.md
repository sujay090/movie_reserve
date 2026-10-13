# Movie Reservation API

Production-oriented backend API for movie discovery and ticket reservations.

The service is built with **Fastify**, **TypeScript**, **PostgreSQL**, **Kysely**, and **Redis**. It is a server-only project; no web or mobile client is included.

## Features

- Cookie-based authentication using PostgreSQL-backed sessions.
- Argon2 password hashing.
- Role-based authorization with `USER` and `ADMIN` roles.
- Movie and genre catalog management.
- Theater, screen, and seat management.
- Showtime scheduling with overlap prevention.
- Per-showtime seat inventory.
- Transactional seat reservations.
- PostgreSQL row locking to prevent double booking.
- Reservation cancellation for upcoming showtimes.
- Reservation idempotency with `Idempotency-Key`.
- Admin user management.
- Reservation, revenue, capacity, and occupancy reports.
- Redis caching and dependency health checks.
- OpenAPI specification and Swagger UI.
- Docker and Docker Compose development environment.

## Technology Stack

| Area | Technology |
|---|---|
| Runtime | Node.js 22 LTS |
| Language | TypeScript |
| HTTP framework | Fastify 5 |
| Database | PostgreSQL 16 |
| SQL access | Kysely |
| Cache | Redis 7 |
| Authentication | PostgreSQL-backed cookie sessions |
| Password hashing | Argon2id |
| API documentation | OpenAPI and Swagger UI |
| Testing | Node test runner / integration tests |
| Local infrastructure | Docker Compose |

## Architecture

```text
API Client
    |
    v
Fastify REST API
    |
    +-- Authentication and Sessions
    +-- Movies and Genres
    +-- Theaters, Screens, and Seats
    +-- Showtimes and Seat Inventory
    +-- Reservations
    +-- Admin Management
    +-- Reports
    |
    +-- PostgreSQL (system of record)
    +-- Redis (cache and health checks)
```

PostgreSQL is authoritative for users, sessions, showtimes, seat inventory, reservations, and reports. Redis is an optimization and must never be used as the source of truth for seat availability.

## Project Structure

```text
src/
├── app.ts                    # Fastify application factory
├── server.ts                 # HTTP server entry point
├── auth/
│   ├── routes.ts             # Signup, login, logout, current user
│   └── session.ts            # Session creation and validation
├── admin/
│   └── routes.ts             # User administration
├── cache/
│   └── redis.ts              # Redis client and cache helpers
├── config/
│   └── env.ts                # Environment validation
├── db/
│   ├── database.ts           # Kysely PostgreSQL connection
│   ├── types.ts              # Typed database interface
│   ├── migrate.ts            # Migration runner
│   ├── seed.ts               # Initial admin seed
│   └── migrations/           # Database migrations
├── movies/
│   └── routes.ts             # Movies and genres
├── reservations/
│   └── routes.ts             # Reservation workflows
├── reports/
│   └── routes.ts             # Admin reporting
├── showtimes/
│   └── routes.ts             # Showtime scheduling and seat maps
├── system/
│   └── routes.ts             # Health and metadata
├── types/
│   └── fastify.d.ts          # Fastify request type extensions
└── venues/
    └── routes.ts             # Theaters, screens, and seats
```

## Requirements

For local development, install:

- Node.js 22 or newer
- npm 10 or newer
- Docker Desktop with Docker Compose

You can run the API directly against local PostgreSQL and Redis, or run all services with Docker Compose.

## Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

### Environment variables

| Variable | Required | Example | Description |
|---|---:|---|---|
| `NODE_ENV` | No | `development` | Runtime environment |
| `HOST` | No | `0.0.0.0` | HTTP bind host |
| `PORT` | No | `3000` | HTTP port |
| `DATABASE_URL` | Yes | `postgresql://movie:movie@localhost:5432/movie_reservation` | PostgreSQL connection string |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection string |
| `SESSION_COOKIE_NAME` | No | `movie_session` | Session cookie name |
| `SESSION_TTL_DAYS` | No | `7` | Session lifetime in days |
| `ADMIN_EMAIL` | Seed only | `admin@example.com` | Initial administrator email |
| `ADMIN_PASSWORD_HASH` | Seed only | Argon2id hash | Precomputed admin password hash |

Never commit `.env` or production secrets to source control. Production secrets should be provided through a secret manager or deployment environment.

## Run with Docker Compose

Start the API, PostgreSQL, and Redis:

```bash
docker compose up --build
```

The API is available at:

```text
http://localhost:3000
```

Stop the services:

```bash
docker compose down
```

Remove local database and Redis volumes:

```bash
docker compose down -v
```

This permanently removes local Docker data. Do not use it against production volumes.

View API logs:

```bash
docker compose logs -f api
```

## Run Locally Without Docker API Container

Start PostgreSQL and Redis separately, then install dependencies:

```bash
npm install
```

Apply database migrations:

```bash
npm run migrate
```

Start the development server:

```bash
npm run dev
```

The development server uses Fastify watch mode.

## Database Migrations

Apply all pending Kysely migrations:

```bash
npm run migrate
```

Current migrations:

1. Users
2. Sessions
3. Movies and genres
4. Theaters, screens, and seats
5. Showtimes and showtime seat inventory
6. Reservations and idempotency requests

Run migrations once as a deployment step. Do not run migrations concurrently from every production API replica.

## Seed the Initial Admin

The seed command requires a precomputed Argon2id or bcrypt password hash:

```bash
ADMIN_EMAIL=admin@example.com \
ADMIN_PASSWORD_HASH='<password-hash>' \
npm run seed
```

The seed is idempotent for the administrator email.

Do not place a plaintext password in `ADMIN_PASSWORD_HASH`, logs, shell history, or source control.

## npm Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Fastify in watch mode |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Start the compiled server |
| `npm run migrate` | Apply Kysely migrations |
| `npm run seed` | Seed the initial administrator |
| `npm test` | Run the test suite |

## API Documentation

Swagger UI:

```text
http://localhost:3000/docs
```

OpenAPI JSON:

```text
http://localhost:3000/docs/json
```

## API Overview

All API routes use the `/api/v1` prefix unless noted otherwise.

### System

```http
GET /health
GET /api/v1/system/health
GET /api/v1/system/metadata
```

The health endpoint checks PostgreSQL and Redis. It returns `200` when dependencies are healthy and `503` when the service is degraded.

### Authentication

```http
POST /api/v1/auth/signup
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/users/me
```

Authentication uses a server-side session:

1. The user signs up or logs in.
2. The server creates a random opaque session ID.
3. Only a SHA-256 hash is stored in PostgreSQL.
4. The raw session ID is sent in an HttpOnly cookie.
5. Each request validates the cookie against the sessions table.

Cookie properties:

- `HttpOnly`
- `SameSite=Lax`
- `Secure` in production
- Configurable `Max-Age`

### Movies and genres

```http
GET  /api/v1/movies
GET  /api/v1/movies/:movieId
GET  /api/v1/genres
POST /api/v1/admin/movies
POST /api/v1/admin/genres
```

Movie list filters:

```text
?page=1
&limit=20
&search=example
&genreId=<genre-id>
```

### Theaters, screens, and seats

```http
GET  /api/v1/theaters
GET  /api/v1/theaters/:theaterId
POST /api/v1/admin/theaters
POST /api/v1/admin/screens
POST /api/v1/admin/seats
```

### Showtimes

```http
GET  /api/v1/showtimes
GET  /api/v1/showtimes/:showtimeId
GET  /api/v1/showtimes/:showtimeId/seats
POST /api/v1/admin/showtimes
POST /api/v1/admin/showtimes/:showtimeId/cancel
```

Showtime filters:

```text
?date=2026-10-13
&movieId=<movie-id>
&theaterId=<theater-id>
```

PostgreSQL prevents overlapping scheduled showtimes on the same screen.

### Reservations

```http
POST /api/v1/showtimes/:showtimeId/reservations
GET  /api/v1/reservations/me
GET  /api/v1/reservations/:reservationId
POST /api/v1/reservations/:reservationId/cancel
```

Create a reservation:

```http
POST /api/v1/showtimes/{showtimeId}/reservations
Content-Type: application/json
Idempotency-Key: unique-request-key
```

```json
{
  "seatIds": [
    "seat-uuid-1",
    "seat-uuid-2"
  ]
}
```

Reservation creation is transactional. Requested seat rows are locked before availability is checked, preventing two users from reserving the same seat.

### Admin users and reports

```http
GET   /api/v1/admin/users
PATCH /api/v1/admin/users/:userId/role
PATCH /api/v1/admin/users/:userId/status

GET /api/v1/admin/reports/reservations
GET /api/v1/admin/reports/revenue
GET /api/v1/admin/reports/capacity
```

Admin report filters:

```text
?from=2026-10-01
&to=2026-10-31
&movieId=<movie-id>
&theaterId=<theater-id>
```

## Response Format

Successful responses include a request ID:

```json
{
  "data": {},
  "requestId": "req-1"
}
```

Errors use stable application codes:

```json
{
  "error": {
    "code": "SEAT_ALREADY_RESERVED",
    "message": "One or more selected seats are no longer available"
  }
}
```

Common status codes:

| Status | Meaning |
|---|---|
| `400` | Invalid request |
| `401` | Missing or invalid session |
| `403` | Insufficient permissions |
| `404` | Resource not found |
| `409` | Seat or scheduling conflict |
| `422` | Schema validation error |
| `500` | Unexpected server error |
| `503` | Dependency or service unavailable |

## Reservation Consistency

The reservation workflow runs in one PostgreSQL transaction:

1. Lock the showtime row.
2. Confirm the showtime is scheduled and upcoming.
3. Lock requested `showtime_seats` rows with `FOR UPDATE`.
4. Confirm every seat is available.
5. Insert the reservation.
6. Insert reservation seat records.
7. Mark inventory rows as reserved.
8. Store the idempotency key, if provided.
9. Commit.

If any requested seat is unavailable, no reservation is created and the API returns `409 Conflict`.

## Security Guidelines

- Use HTTPS in staging and production.
- Never store plaintext passwords.
- Never log passwords, session IDs, cookies, or secrets.
- Keep session IDs opaque and store only their hashes.
- Rotate or revoke sessions when accounts are suspended.
- Use strict request schemas and parameterized Kysely queries.
- Keep production secrets outside source control.
- Use least-privilege database credentials.
- Configure CORS for trusted origins only.
- Apply rate limits to signup, login, logout, and report endpoints.
- Use database backups with point-in-time recovery.
- Run dependency audits during CI.

## Production Deployment

The API is designed as a stateless Fastify application. Multiple API instances can run behind a load balancer because sessions are stored in PostgreSQL rather than local memory.

Recommended production components:

- Managed PostgreSQL with automated backups.
- Managed Redis with authentication and TLS.
- Multiple Fastify API replicas.
- HTTPS load balancer.
- Secret manager.
- Centralized structured logs.
- Metrics and alerting.
- Separate migration job.

Production deployment order:

1. Build and scan the container image.
2. Apply database migrations once.
3. Deploy the new API version.
4. Verify `/health`.
5. Verify Swagger/OpenAPI availability if publicly exposed.
6. Monitor error rate, latency, database connections, Redis health, and reservation conflicts.

The included Dockerfile uses a multi-stage build and runs the production process as the non-root `node` user.

## Testing

Minimum production test coverage should include:

- Signup and login validation.
- Session cookie creation and logout.
- Suspended-user access rejection.
- Admin authorization.
- Movie and showtime validation.
- Overlapping showtime rejection.
- Reservation ownership.
- Reservation cancellation and seat release.
- Idempotent reservation retries.
- Concurrent requests for the same seat.
- Revenue and occupancy calculations.

Run the current test command:

```bash
npm test
```

Build validation:

```bash
npm run build
```

Dependency audit:

```bash
npm audit --omit=dev --audit-level=high
```

## Design Documents

- [High-Level Design](./HLD.md)
- [System and Database Design](./DESIGN.md)

## License

This project does not currently declare a license. Add an explicit license before distributing or publishing the repository.
