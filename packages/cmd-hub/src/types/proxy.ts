import { Infer, object, optional, string, number } from 'superstruct'

export const ProxyTypeSign = object({
    host: string(),
    port: number(),
    protocol: optional(string()),
    auth: optional(
        object({
            user: string(),
            password: string()
        })
    )
})

export class Proxy implements ProxyType {
    host: string
    port: number
    protocol: string
    auth?: {
        user: string
        password: string
    }
    constructor(proxy: ProxyType) {
        this.host = proxy.host
        this.port = proxy.port
        this.protocol = proxy.protocol || "http"
        this.auth = proxy.auth
    }

    toString(): string {
        return this.protocol + (this.auth ? this.auth.user + ":" + this.auth.password + "@" : "") + this.host + ":" + this.port
    }
}

export type ProxyType = Infer<typeof ProxyTypeSign>
