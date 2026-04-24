import { z } from 'zod'

const ConfigSchema = z.object({
    mongo: z.object({
        url: z.string().min(1),
    }),
    hub: z.object({
        grpcBindAddress: z.string().min(1),
        publicBaseUrl: z.string().min(1),
        uploadHttpPort: z.coerce.number().int().positive(),
        autoRegister: z.coerce.boolean().default(false),
    }),
    telegram: z.object({
        botToken: z.string().min(1),
        adminUserIds: z.array(z.coerce.number()).default([]),
    }),
    proxy: z.object({
        socks: z.string().optional(),
        https: z.string().optional(),
    }).default({}),
})

export type AppConfig = z.infer<typeof ConfigSchema>

/** Load config from env vars. Missing required vars throw clearly. */
export function loadConfig(): AppConfig {
    const adminRaw = process.env.TELEGRAM_ADMIN_USER_IDS ?? ''
    return ConfigSchema.parse({
        mongo: { url: process.env.MONGO_URL ?? '' },
        hub: {
            grpcBindAddress: process.env.HUB_GRPC_BIND_ADDRESS ?? '0.0.0.0:50051',
            publicBaseUrl: process.env.HUB_PUBLIC_BASE_URL ?? '',
            uploadHttpPort: process.env.HUB_UPLOAD_HTTP_PORT ?? '3000',
            autoRegister: process.env.AUTH_AUTO_REGISTER ?? 'false',
        },
        telegram: {
            botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
            adminUserIds: adminRaw ? adminRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
        },
        proxy: {
            socks: process.env.ALL_PROXY || process.env.SOCKS_PROXY || process.env.all_proxy || process.env.socks_proxy,
            https: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy,
        },
    })
}
