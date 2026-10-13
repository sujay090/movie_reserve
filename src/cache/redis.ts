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

export async function closeRedis(): Promise<void> {
  if (redis.isOpen) await redis.quit();
}
