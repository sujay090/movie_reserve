# Movie Reservation System Design

## 1. Goal

The system allows users to:

- Create an account and log in.
- Browse movies, genres, theaters, and showtimes.
- View available seats for a showtime.
- Reserve and cancel tickets.
- View their reservation history.

Administrators can manage movies, theaters, screens, seats, and showtimes. They can also view reservation, capacity, and revenue reports.

## 2. Backend Stack

- **Backend:** TypeScript with Fastify
- **Database:** PostgreSQL
- **Query builder:** Kysely
- **Cache:** Redis
- **Authentication:** PostgreSQL-backed sessions identified by an HttpOnly cookie
- **Password hashing:** Argon2id or bcrypt
- **API:** REST under `/api/v1`
- **Testing:** Jest and Supertest
- **Local infrastructure:** Docker Compose
- **Production:** Containerized Fastify API with managed PostgreSQL and Redis

This is a server-only project. No web or mobile client is included.

## 3. System Architecture

```text
API Client
        |
        v
HTTPS / Reverse Proxy
        |
        v
Fastify REST API
  ├── Authentication and Users (cookie sessions)
  ├── Movies and Genres
  ├── Theaters, Screens, and Seats
  ├── Showtimes
  ├── Reservations
  └── Admin Reports
        |
        v
PostgreSQL accessed through Kysely
        |
        v
Redis cache and rate limiting
```

### Main rules

1. All protected endpoints require authentication.
2. Admin endpoints require the `ADMIN` role.
3. Reservations are created inside a database transaction.
4. PostgreSQL row locks prevent two users from reserving the same seat.
5. All timestamps are stored in UTC.
6. Movies and other records with historical reservations should be archived rather than physically deleted.

## 4. Roles

| Capability | User | Admin |
|---|---:|---:|
| Sign up and log in | Yes | Yes |
| Browse movies and showtimes | Yes | Yes |
| View available seats | Yes | Yes |
| Reserve seats | Yes | Yes |
| View and cancel own reservations | Yes | Yes |
| Manage movies and genres | No | Yes |
| Manage theaters, screens, and seats | No | Yes |
| Manage showtimes | No | Yes |
| View all reservations and reports | No | Yes |
| Promote users to admin | No | Yes |

The first admin is created by a database seed script. Users cannot change their own role.

## 5. Database Entity Relationships

```text
User 1 ──── * Reservation 1 ──── * ReservationSeat * ──── 1 Seat

Movie * ──── * Genre
Movie 1 ──── * Showtime * ──── 1 Screen

Theater 1 ──── * Screen 1 ──── * Seat
Showtime 1 ──── * ShowtimeSeat * ──── 1 Seat
```

`showtime_seats` is a per-showtime inventory table. It makes availability, locking, cancellation, and reporting reliable.

## 6. PostgreSQL Schema

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'USER',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (role IN ('USER', 'ADMIN')),
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED'))
);

CREATE TABLE sessions (
    id VARCHAR(128) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE genres (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE movies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    poster_url TEXT,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    release_date DATE,
    age_rating VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE TABLE movie_genres (
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    genre_id UUID NOT NULL REFERENCES genres(id) ON DELETE RESTRICT,
    PRIMARY KEY (movie_id, genre_id)
);

CREATE TABLE theaters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE screens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theater_id UUID NOT NULL REFERENCES theaters(id) ON DELETE RESTRICT,
    name VARCHAR(100) NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (theater_id, name)
);

CREATE TABLE seats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    row_label VARCHAR(10) NOT NULL,
    seat_number INTEGER NOT NULL CHECK (seat_number > 0),
    seat_type VARCHAR(20) NOT NULL DEFAULT 'REGULAR',
    is_active BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (screen_id, row_label, seat_number),
    CHECK (seat_type IN ('REGULAR', 'PREMIUM', 'ACCESSIBLE'))
);

CREATE TABLE showtimes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE RESTRICT,
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE RESTRICT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    ticket_price NUMERIC(10, 2) NOT NULL CHECK (ticket_price >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),
    CHECK (status IN ('SCHEDULED', 'CANCELLED', 'COMPLETED'))
);

ALTER TABLE showtimes
ADD CONSTRAINT no_overlapping_showtimes
EXCLUDE USING gist (
    screen_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
)
WHERE (status = 'SCHEDULED');

CREATE TABLE reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_code VARCHAR(30) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    showtime_id UUID NOT NULL REFERENCES showtimes(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
    total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status IN ('CONFIRMED', 'CANCELLED', 'EXPIRED'))
);

CREATE TABLE showtime_seats (
    showtime_id UUID NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
    seat_id UUID NOT NULL REFERENCES seats(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    reserved_at TIMESTAMPTZ,
    PRIMARY KEY (showtime_id, seat_id),
    CHECK (status IN ('AVAILABLE', 'RESERVED'))
);

CREATE TABLE reservation_seats (
    reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    seat_id UUID NOT NULL REFERENCES seats(id) ON DELETE RESTRICT,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    PRIMARY KEY (reservation_id, seat_id)
);
```

## 7. Important Indexes

```sql
CREATE INDEX idx_showtimes_movie_date
    ON showtimes (movie_id, starts_at);

CREATE INDEX idx_showtimes_screen_date
    ON showtimes (screen_id, starts_at);

CREATE INDEX idx_showtime_seats_status
    ON showtime_seats (showtime_id, status);

CREATE INDEX idx_reservations_user_created
    ON reservations (user_id, created_at DESC);

CREATE INDEX idx_reservations_showtime_status
    ON reservations (showtime_id, status);
```

## 8. Reservation Flow

### Creating a showtime

1. The admin creates a scheduled showtime.
2. The service validates that the screen has no overlapping showtime.
3. The service copies every active screen seat into `showtime_seats` as `AVAILABLE`.

```sql
INSERT INTO showtime_seats (showtime_id, seat_id)
SELECT :showtime_id, id
FROM seats
WHERE screen_id = :screen_id
  AND is_active = true;
```

### Reserving seats

Execute the following in one transaction:

1. Validate the authenticated user and showtime.
2. Lock requested seats with `SELECT ... FOR UPDATE`.
3. Confirm every seat exists and is `AVAILABLE`.
4. Create the reservation.
5. Create `reservation_seats` rows using the server-side ticket price.
6. Update the seats to `RESERVED`.
7. Commit.

```sql
BEGIN;

SELECT showtime_id, seat_id, status
FROM showtime_seats
WHERE showtime_id = :showtime_id
  AND seat_id = ANY(:seat_ids)
FOR UPDATE;

-- Application verifies that every requested row is AVAILABLE.

INSERT INTO reservations (
    reservation_code, user_id, showtime_id, total_amount
)
VALUES (:code, :user_id, :showtime_id, :total_amount)
RETURNING id;

INSERT INTO reservation_seats (reservation_id, seat_id, price)
SELECT :reservation_id, seat_id, :ticket_price
FROM showtime_seats
WHERE showtime_id = :showtime_id
  AND seat_id = ANY(:seat_ids);

UPDATE showtime_seats
SET status = 'RESERVED',
    reservation_id = :reservation_id,
    reserved_at = now()
WHERE showtime_id = :showtime_id
  AND seat_id = ANY(:seat_ids)
  AND status = 'AVAILABLE';

COMMIT;
```

If any requested seat is not available, roll back and return `409 Conflict`.

### Cancelling a reservation

Cancellation must verify ownership and that the showtime has not started. In one transaction:

```sql
UPDATE reservations
SET status = 'CANCELLED',
    cancelled_at = now(),
    updated_at = now()
WHERE id = :reservation_id
  AND user_id = :user_id
  AND status = 'CONFIRMED'
  AND showtime_id IN (
      SELECT id FROM showtimes WHERE starts_at > now()
  );

UPDATE showtime_seats
SET status = 'AVAILABLE',
    reservation_id = NULL,
    reserved_at = NULL
WHERE reservation_id = :reservation_id;
```

## 9. REST API

### Authentication

```text
POST /api/v1/auth/signup
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/users/me
```

### Public browsing

```text
GET /api/v1/movies
GET /api/v1/movies/:movieId
GET /api/v1/movies/:movieId/showtimes?date=YYYY-MM-DD
GET /api/v1/showtimes?date=YYYY-MM-DD&city=...
GET /api/v1/showtimes/:showtimeId/seats
```

### User reservations

```text
POST /api/v1/showtimes/:showtimeId/reservations
GET  /api/v1/reservations/me
GET  /api/v1/reservations/:reservationId
POST /api/v1/reservations/:reservationId/cancel
```

### Admin endpoints

```text
POST   /api/v1/admin/movies
PATCH  /api/v1/admin/movies/:movieId
DELETE /api/v1/admin/movies/:movieId

POST   /api/v1/admin/theaters
POST   /api/v1/admin/screens
POST   /api/v1/admin/seats
POST   /api/v1/admin/showtimes
PATCH  /api/v1/admin/showtimes/:showtimeId
POST   /api/v1/admin/showtimes/:showtimeId/cancel

GET /api/v1/admin/reports/reservations
GET /api/v1/admin/reports/capacity
GET /api/v1/admin/reports/revenue
```

## 10. Error Responses

```json
{
  "error": {
    "code": "SEAT_ALREADY_RESERVED",
    "message": "One or more selected seats are no longer available",
    "requestId": "req_123"
  }
}
```

Use:

- `400` for malformed requests
- `401` for unauthenticated requests
- `403` for insufficient permissions
- `404` for missing resources
- `409` for seat conflicts or schedule conflicts
- `422` for validation errors

## 11. Reporting

Reports should count only confirmed reservations unless a report specifically asks for cancellations.

```sql
SELECT
    s.id AS showtime_id,
    COUNT(ss.seat_id) AS capacity,
    COUNT(ss.seat_id) FILTER (WHERE ss.status = 'RESERVED') AS reserved_seats,
    ROUND(
        COUNT(ss.seat_id) FILTER (WHERE ss.status = 'RESERVED') * 100.0
        / NULLIF(COUNT(ss.seat_id), 0),
        2
    ) AS occupancy_percentage
FROM showtimes s
JOIN showtime_seats ss ON ss.showtime_id = s.id
GROUP BY s.id;
```

```sql
SELECT
    COUNT(*) AS reservation_count,
    COALESCE(SUM(total_amount), 0) AS revenue
FROM reservations
WHERE status = 'CONFIRMED'
  AND created_at >= :from_date
  AND created_at < :to_date;
```

## 12. Project Structure

```text
src/
├── config/
├── common/
│   ├── errors/
│   ├── guards/
│   ├── middleware/
│   └── validation/
├── database/
│   ├── migrations/
│   └── seed/
└── modules/
    ├── auth/
    ├── users/
    ├── movies/
    ├── genres/
    ├── theaters/
    ├── screens/
    ├── seats/
    ├── showtimes/
    ├── reservations/
    └── reports/
```

## 13. Implementation Order

1. Configure the backend, PostgreSQL, migrations, linting, and tests.
2. Implement users, password hashing, cookie-session authentication, and admin authorization.
3. Implement genres and movie management.
4. Implement theaters, screens, and seats.
5. Implement showtimes and overlap validation.
6. Generate showtime seat inventory.
7. Implement transactional seat reservations.
8. Implement reservation history and cancellation.
9. Implement capacity and revenue reports.
10. Add integration, concurrency, security, and end-to-end tests.

## 14. Future Extensions

- Payment processing and refunds.
- Temporary seat holds with expiration.
- Email and SMS notifications.
- Coupons and dynamic ticket pricing.
- Reviews and ratings.
- Advanced Redis seat holds and distributed rate limiting.
- Background jobs for expired holds and notifications.

## 15. Fastify Server Structure

```text
src/
├── app.ts                 # Creates and configures the Fastify instance
├── server.ts              # Loads configuration and starts the server
├── config/
│   └── env.ts             # Validates environment variables
├── db/
│   ├── database.ts        # Kysely PostgreSQL connection
│   ├── types.ts           # Typed database schema
│   ├── migrations/
│   └── seed.ts
├── plugins/
│   ├── auth.ts            # Session-cookie verification and request.user
│   ├── cache.ts           # Redis client and cache helpers
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

Each module registers a Fastify route plugin and keeps business rules in a service. Kysely queries belong in repositories or data-access functions. Fastify JSON schemas or TypeBox schemas validate every request and generate OpenAPI documentation.

## 16. API Contract

Base path:

```text
/api/v1
```

Successful response:

```json
{
  "data": {},
  "requestId": "req_01J..."
}
```

Error response:

```json
{
  "error": {
    "code": "SEAT_ALREADY_RESERVED",
    "message": "One or more selected seats are no longer available",
    "requestId": "req_01J..."
  }
}
```

### Authentication

```text
POST /auth/signup
POST /auth/login
POST /auth/logout
GET  /users/me
```

### Catalog

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

Create reservation request:

```json
{
  "seatIds": ["seat-uuid-1", "seat-uuid-2"]
}
```

Clients should send an `Idempotency-Key` header. The server stores the key and response for a limited period so a network retry cannot create a duplicate reservation.

### Administration

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

| Status | Meaning |
|---|---|
| `400` | Malformed request |
| `401` | Missing or invalid authentication |
| `403` | Insufficient permissions |
| `404` | Resource not found |
| `409` | Seat or schedule conflict |
| `422` | Validation failure |

## 17. Docker Compose

`docker-compose.yml` should provide the Fastify API, PostgreSQL, and Redis for local development:

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
      DATABASE_URL: postgresql://movie:movie@postgres:5432/movie_reservation
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      SESSION_COOKIE_NAME: movie_session
      SESSION_TTL_DAYS: 7
    volumes:
      - .:/app
      - /app/node_modules
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}"]
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

Recommended scripts:

```text
npm run dev
npm run build
npm run start
npm run migrate
npm run seed
npm test
```

Production migrations must run as a separate deployment step, not concurrently from every API replica. Development credentials above must be replaced with secrets in production.
