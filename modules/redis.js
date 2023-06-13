const redis = require('redis')
const redisClient = new Promise(async (resolve, reject) => {
    const client = redis.createClient({
        // url: process.env.REDIS_URL || 'redis://:WlloPwMC90834323jkie@43.142.54.128:6379/1',
        url: process.env.REDIS_URL || 'redis://:1@154.22.117.20:6379/1',
    })

    client.on('connect', () => {
        console.log('[Redis] client connected')
    })

    client.on('ready', () => {
        console.log("[Redis] ready")
        resolve(client)
    })

    client.on("error", async (error) => {
        console.error(`[Redis] error: ${error}`)
        await client.connect()
        // reject(error)
    })
    await client.connect()

})

module.exports = async (namespace) => {
    const client = await redisClient
    return {
        redisclient: client,
        get: async (key) => JSON.parse(await client.get(`${namespace}:${key}`)),
        set: (key, value, expirySeconds) => {
            const namespacedKey = `${namespace}:${key}`;
            const stringValue = JSON.stringify(value);
            if (expirySeconds) {
                client.set(namespacedKey, stringValue)
                client.expire(namespacedKey, expirySeconds);
            } else {
                client.set(namespacedKey, stringValue);
            }
        },
        del: (key) => client.del(`${namespace}:${key}`),
        push: (value) => client.rPush(namespace, JSON.stringify(value)),
        hset: (key, field, value) => client.HSET(`${namespace}:${key}`, field, JSON.stringify(value)),
        hget: async (key, field) => {
            const namespacedKey = `${namespace}:${key}`;
            const value = await client.HGET(namespacedKey, field);
            return JSON.parse(value);
        },
        pop: async () => JSON.parse(await client.lPop(namespace)),
        keys: async (pattern) => {
            const client = await redisClient;
            return new Promise((resolve, reject) => {
                client.keys(`${namespace}:${pattern}`, (err, keys) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(keys.map(key => key.replace(`${namespace}:`, '')));
                    }
                });
            });
        },
        lLen: async (key) => {
            const client = await redisClient;
            return new Promise((resolve, reject) => {
                client.LLEN(`${key}`, (err, len) => {
                    if (err) {
                        reject(err);
                    } else {
                        console.log(len)
                        resolve(len);
                    }
                });
            });
        }
    }
}