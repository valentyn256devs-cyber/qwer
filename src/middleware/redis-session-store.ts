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
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
      connectTimeout: 10000,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    this.redis.on('connect', () => {
      console.log('[RedisSessionStore] Redis connected');
    });

    this.redis.on('error', (err) => {
      console.error(`[RedisSessionStore] Redis error: ${err.message}`);
    });

    this.redis.on('close', () => {
      console.warn('[RedisSessionStore] Redis connection closed');
    });
  }

  async get(key: string): Promise<Record<string, any> | undefined> {
    try {
      const raw = await this.redis.get(this.prefix + key);
      return raw ? JSON.parse(raw) : undefined;
    } catch (err) {
      console.error(`[RedisSessionStore] get failed: ${(err as Error).message}`);
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
      console.error(`[RedisSessionStore] set failed: ${(err as Error).message}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(this.prefix + key);
    } catch (err) {
      console.error(`[RedisSessionStore] delete failed: ${(err as Error).message}`);
    }
  }
}
