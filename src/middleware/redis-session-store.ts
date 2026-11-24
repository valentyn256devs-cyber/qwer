import Redis from 'ioredis';

/**
 * Формує правильний Redis URL з окремих параметрів.
 *
 * @param host — хост Redis (за замовчуванням "localhost")
 * @param port — порт Redis (за замовчуванням 6379)
 * @param password — пароль Redis (опціонально)
 * @returns Redis URL у форматі redis://[:password@]host:port
 */
export function buildRedisUrl(
  host: string,
  port: number | string,
  password?: string,
): string {
  const auth = password ? `:${password}@` : '';
  return `redis://${auth}${host}:${port}`;
}

/**
 * Postійне сховище сесій Telegraf на основі Redis.
 *
 * Замість стандартного `session()` (MemorySessionStore), дані сесії
 * (включаючи `ctx.session.__scenes` — стан сцени користувача) зберігаються
 * в Redis. Це дозволяє відновлювати сесії після рестарту сервера, і кнопки
 * всередині сцен будуть працювати відразу без натискання /start.
 *
 * Redis URL може містити пароль у форматі: redis://:password@host:port
 * Якщо Redis недоступний, методи повертають undefined / мікчаться тихо,
 * щоб бот міг працювати без Redis (сесії просто не будуть постійними).
 */
export class RedisSessionStore {
  private readonly redis: Redis;
  private readonly prefix: string;
  private readonly ttlSeconds: number;

  constructor(
    redisUrl: string,
    prefix = 'telegraf:session:',
    ttlSeconds = 60 * 60 * 24 * 7, // 7 днів
  ) {
    this.prefix = prefix;
    this.ttlSeconds = ttlSeconds;

    const parsed = new URL(redisUrl);
    const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
    const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;

    this.redis = new Redis(redisUrl, {
      username,
      password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

    this.redis.on('error', (err) => {
      console.warn(`[RedisSessionStore] Redis error: ${err.message}`);
    });
  }

  async get(key: string): Promise<Record<string, any> | undefined> {
    try {
      const raw = await this.redis.get(this.prefix + key);
      return raw ? JSON.parse(raw) : undefined;
    } catch (err) {
      console.warn(`[RedisSessionStore] get failed: ${(err as Error).message}`);
      return undefined;
    }
  }

  async set(key: string, session: Record<string, any>): Promise<void> {
    try {
      const payload = JSON.stringify(session);
      if (this.ttlSeconds > 0) {
        await this.redis.set(this.prefix + key, payload, 'EX', this.ttlSeconds);
      } else {
        await this.redis.set(this.prefix + key, payload);
      }
    } catch (err) {
      console.warn(`[RedisSessionStore] set failed: ${(err as Error).message}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(this.prefix + key);
    } catch (err) {
      console.warn(`[RedisSessionStore] delete failed: ${(err as Error).message}`);
    }
  }
}
