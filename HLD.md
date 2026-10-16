# Movie Reservation System — High-Level Design

## 1. Overview

The Movie Reservation System is a backend platform that allows customers to discover movies and showtimes, view real-time seat availability, reserve seats, and manage their reservations. Administrators manage the movie catalog, theaters, screens, seating layouts, and showtimes, and access operational reports.

The design prioritizes:

- Correct seat allocation under concurrent requests.
- Clear separation between customer and administration capabilities.
- Reliable reservation and cancellation workflows.
- Horizontal scalability for browsing traffic.
- Transactional consistency for inventory updates.
- Secure authentication and authorization.

## 2. Scope

### In scope

- User registration and authentication.
- Role-based access control.
- Movie and genre catalog.
- Theater, screen, and seat management.
- Showtime scheduling.
- Seat availability.
- Ticket reservations and cancellation.
- Capacity, occupancy, and revenue reporting.
- Audit and operational observability.

### Out of scope for the first release

- Payment provider integration.
- Memberships and loyalty points.
- Promotions and coupon campaigns.
- Reviews and ratings.
- Recommendation engine.
- Multi-region active-active deployment.

## 3. Quality Attributes

| Attribute | Target |
|---|---|
| Availability | 99.9% for customer APIs |
| Reservation correctness | No double booking of a seat |
| Read latency | p95 below 300 ms for catalog and showtime reads |
| Reservation latency | p95 below 1 second excluding external payment |
| Scalability | Stateless API instances can scale horizontally |
| Durability | Database-backed reservation records with backups |
| Security | Authenticated access, least privilege, encrypted transport |
| Auditability | Important admin and reservation events are traceable |

## 4. Context Diagram

```text
                         +------------------+
                         | Customer Web/App |
                         +--------+---------+
                                  |
                         HTTPS / REST API
                                  |
+----------------+        +-------v--------+        +------------------+
| Admin Web/App  +------->| API Gateway    |<-------+ Monitoring Tools |
+----------------+        +-------+--------+        +------------------+
                                  |
                           +------v------+
                           | Backend API |
                           +------+------+
                                  |
               +------------------+------------------+
               |                  |                  |
        +------v------+    +------v------+    +------v------+
        | PostgreSQL  |    | Redis       |    | Object      |
        | Primary DB  |    | Cache/Rate  |    | Storage     |
        +------+------+    +-------------+    | Posters     |
               |                             +-------------+
        +------v------+
        | Read Replica|
        | Optional    |
        +-------------+
```

## 5. Logical Components

### 5.1 API Gateway / Reverse Proxy

Responsibilities:

- TLS termination.
- Routing requests to API instances.
- Request size limits.
- Basic throttling.
- Correlation/request ID generation.
- Health check routing.

Examples include Nginx, a cloud load balancer, or an API gateway service.

### 5.2 Backend API

The API is stateless and can run multiple instances behind the gateway.

Suggested modules:

```text
Auth and Users
Movies and Genres
Theaters, Screens, and Seats
Showtimes
Reservations
Reports
Notifications
Audit
```

Each module should contain its own controller, service, validation, repository, and tests. Cross-module business operations should use service interfaces rather than direct access to another module's tables.

### 5.3 PostgreSQL

PostgreSQL is the system of record for:

- Users and roles.
- Movies and genres.
- Theaters, screens, and seats.
- Showtimes.
- Per-showtime seat inventory.
- Reservations and reservation seats.
- Audit records.

The database is authoritative for reservation state. Cache data must never be used as the final source of truth when confirming a reservation.

### 5.4 Redis

Redis is part of the local and production architecture and provides:

- Catalog and showtime read caching.
- Login and API rate limiting.
- Short-lived idempotency keys.
- Distributed locks for non-critical coordination.

Redis must not replace PostgreSQL row locking for seat allocation.

### 5.5 Object Storage

Movie posters should be stored in object storage. The database stores only the poster URL or object key.

Recommended flow:

1. API creates a short-lived upload URL.
2. Client uploads the image directly to object storage.
3. API stores the resulting object key.
4. Access is provided through a CDN or signed URL.

### 5.6 Background Workers

A worker process can handle non-blocking tasks:

- Expiring temporary seat holds.
- Sending reservation confirmations.
- Sending cancellation notifications.
- Generating large reports.
- Cleaning expired sessions.

The worker must be idempotent because jobs can be delivered more than once.

## 6. Deployment Architecture

```text
                         Internet
                            |
                    +-------v--------+
                    | Load Balancer  |
                    +-------+--------+
                            |
             +--------------+--------------+
             |                             |
      +------v------+               +------v------+
      | API Instance|               | API Instance|
      +------+------+               +------+------+
             |                             |
             +--------------+--------------+
                            |
                    +-------v--------+
                    | PostgreSQL     |
                    | Primary        |
                    +-------+--------+
                            |
                    +-------v--------+
                    | Read Replica   |
                    +----------------+

      API / Worker ----> Redis ----> Job Queue
      API -------------> Object Storage / CDN
```

### Environments

- **Development:** Docker Compose with Fastify API and Redis, connected to the configured remote PostgreSQL database.
- **Test:** Isolated database per test run or ephemeral database container.
- **Staging:** Production-like infrastructure with test data.
- **Production:** Managed PostgreSQL, load balancer, multiple API instances, object storage, monitoring, and automated backups.

## 7. Core Request Flows

### 7.1 Browse movies and showtimes

```text
Client
  -> API Gateway
  -> Movie/Showtime API
  -> Redis cache
  -> PostgreSQL on cache miss
  -> API response
```

Catalog responses can be cached briefly because movies and showtimes change less frequently than reservations.

Cache invalidation events should occur after:

- Movie create/update/archive.
- Genre changes.
- Showtime create/update/cancellation.

### 7.2 View available seats

```text
Client
  -> GET /showtimes/{id}/seats
  -> Reservation service
  -> PostgreSQL showtime_seats
  -> Seat map response
```

Seat availability may be cached for a very short period for display, but the reservation transaction must always re-check the database.

### 7.3 Reserve seats

```text
Client
  -> POST /showtimes/{id}/reservations
  -> Authenticate user
  -> Validate request
  -> Begin database transaction
  -> Lock requested showtime_seats rows
  -> Verify all seats are AVAILABLE
  -> Create reservation and reservation_seats
  -> Mark seats RESERVED
  -> Commit transaction
  -> Publish confirmation job
  -> Return reservation
```

If one requested seat is unavailable, the complete transaction is rolled back and the client receives `409 Conflict`. Partial reservations are not created.

### 7.4 Cancel a reservation

```text
Client
  -> POST /reservations/{id}/cancel
  -> Authenticate user
  -> Verify ownership and cancellation policy
  -> Begin transaction
  -> Mark reservation CANCELLED
  -> Release showtime seats
  -> Commit
  -> Publish notification job
  -> Return updated reservation
```

### 7.5 Admin creates a showtime

```text
Admin
  -> Admin API
  -> Verify ADMIN role
  -> Validate movie, screen, and time range
  -> Create showtime
  -> Reject overlapping showtime
  -> Populate showtime_seats from active screen seats
  -> Invalidate relevant cache
```

## 8. Concurrency and Overbooking Prevention

The reservation service uses the `showtime_seats` table as inventory.

For each reservation:

1. Start a PostgreSQL transaction.
2. Lock all requested rows using `SELECT ... FOR UPDATE`.
3. Sort requested seat IDs before locking to reduce deadlock risk.
4. Verify that every requested seat is available.
5. Insert the reservation.
6. Insert reservation seat records with the current server-side price.
7. Update inventory rows to `RESERVED`.
8. Commit.

Concurrent requests for the same seat are serialized by the database. Only the transaction that observes the seat as available can succeed.

### Optional seat holds

If payment is introduced, inventory can have this state machine:

```text
AVAILABLE -> HELD -> RESERVED
     ^         |
     +---------+
       expires
```

The hold expiration timestamp is stored in the database. A worker releases expired holds, while the reservation path also checks expiration defensively.

## 9. Data Ownership and Consistency

### Strong consistency

The following operations must use a database transaction:

- Seat reservation.
- Reservation cancellation.
- Showtime creation with seat inventory creation.
- Reservation status changes.
- Seat hold expiration.

### Eventual consistency

The following can be asynchronous:

- Email and SMS notifications.
- Cache invalidation.
- Large report generation.
- Analytics aggregation.

The user-facing reservation response is returned only after the reservation transaction commits.

## 10. API Design

Base path:

```text
/api/v1
```

### Customer endpoints

```text
POST /auth/signup
POST /auth/login
POST /auth/logout
GET  /users/me

GET  /movies
GET  /movies/{movieId}
GET  /movies/{movieId}/showtimes?date=YYYY-MM-DD
GET  /showtimes?date=YYYY-MM-DD&city={city}
GET  /showtimes/{showtimeId}/seats

POST /showtimes/{showtimeId}/reservations
GET  /reservations/me
GET  /reservations/{reservationId}
POST /reservations/{reservationId}/cancel
```

### Admin endpoints

```text
POST   /admin/movies
PATCH  /admin/movies/{movieId}
DELETE /admin/movies/{movieId}

POST   /admin/genres
POST   /admin/theaters
POST   /admin/screens
POST   /admin/seats
POST   /admin/showtimes
PATCH  /admin/showtimes/{showtimeId}
POST   /admin/showtimes/{showtimeId}/cancel

GET /admin/users
PATCH /admin/users/{userId}/role
GET /admin/reports/reservations
GET /admin/reports/capacity
GET /admin/reports/revenue
```

### Standard response behavior

```json
{
  "data": {},
  "requestId": "req_123"
}
```

```json
{
  "error": {
    "code": "SEAT_ALREADY_RESERVED",
    "message": "One or more selected seats are no longer available",
    "requestId": "req_123"
  }
}
```

Use `409 Conflict` for reservation conflicts and schedule conflicts. Never return a successful-looking response when a reservation was not committed.

## 11. Authentication and Authorization

### Authentication

- Hash passwords with Argon2id or bcrypt.
- Create a cryptographically random opaque session ID after login.
- Store only a SHA-256 hash of the session ID in PostgreSQL.
- Set the raw session ID in an HttpOnly, Secure-in-production, SameSite=Lax cookie.
- Delete the server-side session on logout or expiry.
- Apply stricter rate limits to signup and login endpoints.

### Authorization

```text
Request
  -> Validate access token
  -> Load user status and role
  -> Reject suspended/deleted users
  -> Check endpoint permission
  -> Execute business operation
```

Authorization checks must be performed on the server. Frontend role checks are only a user-experience feature.

## 12. Reliability and Failure Handling

### Database failure

- Use a managed PostgreSQL service where possible.
- Enable automated backups and point-in-time recovery.
- Configure connection pooling.
- Retry only safe, transient database operations.
- Do not blindly retry a reservation after an ambiguous commit result without an idempotency key.

### API instance failure

Because sessions are stored in PostgreSQL, traffic can be routed to any API instance without sticky sessions. Every instance validates the cookie against the shared sessions table.

### Worker failure

- Store jobs durably in a queue.
- Use retry with exponential backoff.
- Use a dead-letter queue after repeated failures.
- Make notification and cleanup handlers idempotent.

### Idempotency

Reservation creation should accept an optional `Idempotency-Key` header. Store the key and resulting response for a short retention period per user. Repeating the same request returns the original result instead of creating a second reservation.

## 13. Scaling Strategy

### Initial scale

- One API service with multiple processes.
- PostgreSQL primary.
- Redis for cache and rate limiting.
- Object storage for posters.

### Growth scale

- Add API instances behind a load balancer.
- Cache public movie and showtime reads.
- Add a PostgreSQL read replica for reports and browsing queries.
- Move large reports to asynchronous jobs.
- Partition or archive old reservation data if the dataset becomes large.
- Add a CDN for poster assets.

### Read/write separation

Reservation, cancellation, and showtime management always use the primary database. Read replicas can serve catalog and completed historical report queries when replica lag is acceptable.

## 14. Security Design

- Enforce HTTPS in every non-local environment.
- Validate and normalize all request input.
- Use parameterized queries or ORM query parameters.
- Apply CORS allowlists.
- Add rate limiting and account lockout protections.
- Do not log passwords, session IDs, cookies, or payment data.
- Encrypt database backups and object storage.
- Use least-privilege database and cloud IAM accounts.
- Store secrets in a secret manager, not in source control.
- Add audit records for admin changes and reservation state changes.
- Use Secure-in-production, HttpOnly, SameSite cookies for sessions.

## 15. Observability

### Logs

Structured logs should include:

- Timestamp.
- Request ID.
- User ID when available.
- Route and HTTP method.
- Status code.
- Duration.
- Error code.

Never log credentials or raw tokens.

### Metrics

Track:

- Request count and error rate by endpoint.
- p50, p95, and p99 latency.
- Database connection pool usage.
- Reservation success and conflict rates.
- Seat hold expiration count.
- Queue depth and failed jobs.
- Cache hit rate.
- PostgreSQL replication lag.

### Tracing

Propagate the request ID through API, database, cache, and worker operations. Distributed tracing can be added when the system is split across multiple services.

### Alerts

Alert on:

- Elevated HTTP 5xx rate.
- Database unavailable or high connection usage.
- High reservation conflict rate.
- Queue backlog.
- Failed migrations or backup failures.
- High replica lag.

## 16. Disaster Recovery

- Automated daily backups.
- Point-in-time recovery for PostgreSQL.
- Regular restore tests.
- Multi-zone database deployment in production.
- Object storage versioning for poster assets.
- Documented recovery runbook.

Example initial targets:

| Metric | Target |
|---|---|
| Recovery Point Objective | 15 minutes |
| Recovery Time Objective | 1 hour |

## 17. Testing Strategy

### Unit tests

- Validation rules.
- Pricing calculations.
- Authorization policies.
- Reservation status transitions.

### Integration tests

- Repository and migration behavior.
- Reservation transaction behavior.
- Showtime overlap constraints.
- Cancellation and seat release.

### Concurrency tests

- Two requests reserving the same seat.
- Two requests reserving overlapping seat sets.
- Reservation against an expiring hold.

Expected result: exactly one conflicting reservation succeeds.

### End-to-end tests

- Signup, login, browse, reserve, view, and cancel.
- Admin creates a movie and showtime.
- Admin views capacity and revenue reports.

## 18. Recommended Delivery Plan

### Release 1 — MVP

1. Authentication and roles.
2. Movies and genres.
3. Theaters, screens, and seats.
4. Showtimes.
5. `showtime_seats` inventory.
6. Transactional reservations.
7. Cancellation.
8. Basic admin reports.

### Release 2 — Operational readiness

1. Structured logging and metrics.
2. Automated backups.
3. Rate limiting.
4. Idempotency keys.
5. Background notifications.
6. Redis caching and rate limiting.
7. Read replica for reporting.

### Release 3 — Commercial features

1. Payment integration.
2. Temporary seat holds.
3. Refund processing.
4. Coupons and dynamic pricing.
5. Customer notifications and loyalty features.

## 19. Design Summary

The system should remain a modular monolith for the initial release. A modular monolith keeps reservation transactions simple and avoids the operational complexity of distributed transactions. The API can scale horizontally because it is stateless, while PostgreSQL remains the authoritative source for seat inventory and reservation state.

The most important design decision is to model one inventory row per seat per showtime and protect reservation changes with PostgreSQL transactions and row locks. This provides a clear, testable guarantee that a seat cannot be sold twice.

## 20. Backend Implementation Standard

The project is a server-only application. No frontend is included.

| Area | Technology |
|---|---|
| Runtime | Node.js 22 LTS |
| Language | TypeScript with strict mode |
| HTTP framework | Fastify |
| Database | PostgreSQL 16+ |
| SQL access | Kysely |
| Cache and rate limiting | Redis 7+ |
| Validation | Fastify JSON Schema or TypeBox |
| API documentation | OpenAPI from Fastify schemas |
| Local environment | Docker Compose |
| Tests | Vitest or Jest with Fastify `inject()` |

### Fastify application structure

```text
src/
├── app.ts                 # Creates the Fastify instance
├── server.ts              # Starts the HTTP server
├── config/env.ts          # Validates environment variables
├── db/
│   ├── database.ts        # Kysely instance
│   ├── types.ts           # Typed database interface
│   └── migrations/
├── plugins/
│   ├── auth.ts
│   ├── cache.ts
│   └── error-handler.ts
├── modules/
│   ├── auth/
│   ├── movies/
│   ├── theaters/
│   ├── showtimes/
│   ├── reservations/
│   └── reports/
└── shared/
    ├── errors/
    ├── pagination/
    └── types/
```

The API is a modular monolith. Modules expose Fastify route plugins and services; database access is implemented with typed Kysely repositories.

## 21. API Design

Base path:

```text
/api/v1
```

### Authentication

```text
POST /auth/signup
POST /auth/login
POST /auth/logout
GET  /users/me
```

### Public catalog

```text
GET /movies?page=1&limit=20&search=...&genreId=...
GET /movies/{movieId}
GET /movies/{movieId}/showtimes?date=YYYY-MM-DD&city=...
GET /showtimes/{showtimeId}/seats
```

### Reservations

```text
POST /showtimes/{showtimeId}/reservations
GET  /reservations/me?status=UPCOMING&page=1&limit=20
GET  /reservations/{reservationId}
POST /reservations/{reservationId}/cancel
```

Reservation request:

```json
{
  "seatIds": ["seat-uuid-1", "seat-uuid-2"]
}
```

Clients should send an `Idempotency-Key` header when creating reservations. The server returns the original result for a repeated key rather than creating another reservation.

### Admin

```text
POST   /admin/movies
PATCH  /admin/movies/{movieId}
DELETE /admin/movies/{movieId}
POST   /admin/genres
POST   /admin/theaters
POST   /admin/screens
POST   /admin/seats
POST   /admin/showtimes
PATCH  /admin/showtimes/{showtimeId}
POST   /admin/showtimes/{showtimeId}/cancel
GET    /admin/users
PATCH  /admin/users/{userId}/role
GET    /admin/reports/reservations
GET    /admin/reports/capacity
GET    /admin/reports/revenue
```

Every response includes a request ID:

```json
{
  "data": {},
  "requestId": "req_01J..."
}
```

Errors use stable application codes:

```json
{
  "error": {
    "code": "SEAT_ALREADY_RESERVED",
    "message": "One or more selected seats are no longer available",
    "requestId": "req_01J..."
  }
}
```

Use `409 Conflict` for unavailable seats and overlapping showtimes, `401` for invalid authentication, `403` for insufficient permissions, and `422` for schema validation errors.

## 22. Docker Design

### Dockerfile

```dockerfile
FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### docker-compose.yml

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    command: npm run dev
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      PORT: 3000
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      SESSION_COOKIE_NAME: movie_session
      SESSION_TTL_DAYS: 7
    volumes:
      - .:/app
      - /app/node_modules
    depends_on:
      redis:
        condition: service_started

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}"]
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

Production migrations must run once as a deployment step, not concurrently from every API replica. Development credentials in this example must be replaced with secrets in production.
