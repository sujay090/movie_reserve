# Security Review

## Scope

This review covered authentication and sessions, authorization, input and database access, Docker Compose exposure, headers, secrets, logging, and reservation concurrency.

## Findings

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟡 MEDIUM | src/auth/routes.ts | 162-163 | Logout read the session cookie using a separate environment lookup instead of the validated configured cookie name. With a custom cookie name, logout could leave the active server-side session valid. | 9/10 |
| 2 | 🟡 MEDIUM | docker-compose.yml | 14-47 | PostgreSQL and Redis used fixed credentials and published database ports, while Redis had no authentication. | 9/10 |

## Remediation

### Finding 1

Logout now uses `env.sessionCookieName`, the same validated configuration used when setting and authenticating the session cookie. This ensures logout deletes the correct server-side session and clears the correct cookie.

### Finding 2

Docker Compose now:

- Requires `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `REDIS_PASSWORD`.
- Builds authenticated PostgreSQL and Redis connection strings from environment variables.
- Requires Redis authentication.
- Keeps PostgreSQL and Redis internal to the Compose network by removing their host port publishing.
- Uses environment-based PostgreSQL health-check credentials.

Only the API port is published by default.

## Existing Controls

- Session IDs are generated with cryptographically secure random bytes.
- Only SHA-256 session hashes are stored in PostgreSQL.
- Session cookies are HttpOnly and SameSite=Lax, and Secure in production.
- Passwords use Argon2 hashing.
- Admin routes enforce authenticated active admin users.
- Reservation operations use PostgreSQL transactions and row locking.
- Kysely parameterizes database queries.
- Helmet is enabled.
- The production container runs as the non-root `node` user.

## Verification

```text
npm run build                         passed
npm test                              3 passed
npm audit --omit=dev --audit-level=high 0 vulnerabilities
docker compose config                 passed with required secrets
```

## Production Recommendations

- Use a managed secret store for all database, Redis, and session configuration.
- Use HTTPS and set secure, trusted CORS origins.
- Add rate limiting for authentication and sensitive administrative endpoints.
- Run regular backup restore tests.
- Monitor failed logins, session failures, reservation conflicts, and dependency health.
