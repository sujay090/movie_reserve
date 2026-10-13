import 'dotenv/config';

const required = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const env = {
  nodeEnv: required('NODE_ENV', 'development'),
  host: required('HOST', '0.0.0.0'),
  port: Number(required('PORT', '3000')),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),
  sessionCookieName: required('SESSION_COOKIE_NAME', 'movie_session'),
  sessionTtlDays: Number(required('SESSION_TTL_DAYS', '7'))
};

if (!Number.isInteger(env.port) || env.port < 1 || env.port > 65535) {
  throw new Error('PORT must be a valid TCP port');
}

if (!Number.isInteger(env.sessionTtlDays) || env.sessionTtlDays < 1) {
  throw new Error('SESSION_TTL_DAYS must be a positive integer');
}
