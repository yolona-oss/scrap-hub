import type { IBaseCmdService_EvMap } from "./base-command-service"

/** Optional event sinks a long-running service can hand to subordinate
 *  workers (sources, exporters, sub-tasks) so they can stream UI events
 *  without holding a direct reference to the service emitter. Each field
 *  is structurally compatible with the matching `IBaseCmdService_EvMap`
 *  entry — the union type lives in one place so the two can't drift.
 *
 *  All fields are optional: older sites that constructed a bare
 *  `ServiceContext` literal still work. */
export interface ServiceContextEvents {
    /** See `IBaseCmdService_EvMap.liveLog`. Use for "agent invoked tool X"
     *  or "source N retried after 503". Keep each line short — UIs may
     *  truncate. */
    liveLog?: IBaseCmdService_EvMap['liveLog']
}

export interface ServiceContext {
    userId: string
    serviceName: string
    sessionId: string
    config: Record<string, any>
    events?: ServiceContextEvents
}
