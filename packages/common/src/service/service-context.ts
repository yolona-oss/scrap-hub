export interface ServiceContext {
    userId: string
    serviceName: string
    sessionId: string
    config: Record<string, any>
}
