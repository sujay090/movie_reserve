import { createClient } from "redis";
import { env } from "../config/env.js";

export const redis = createClient({ url: env.redisUrl });

redis.on("error", (error) => {
  console.error("Redis client error", error);
});

export async function pingRedis(): Promise<boolean> {
  if (!redis.isOpen) await redis.connect();
  return (await redis.ping()) === "PONG";
}

export async function getJson<T>(key: string): Promise<T | null> {
  if (!redis.isOpen) await redis.connect();
  const value = await redis.get(key);
  return value ? (JSON.parse(value) as T) : null;
}

export async function setJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  if (!redis.isOpen) await redis.connect();
  await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
}

export async function deleteKey(key: string): Promise<void> {
  if (!redis.isOpen) await redis.connect();
  await redis.del(key);
}

export async function closeRedis(): Promise<void> {
  if (redis.isOpen) await redis.quit();
}
