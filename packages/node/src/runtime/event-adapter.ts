import { CmdHubProto } from '@cmd-hub/transport'
import {
    INodeUiMessageRegistry,
    UiMessage,
    log,
} from '@cmd-hub/common'

type InvokeServer = CmdHubProto.InvokeServer
type IntercomAction = CmdHubProto.IntercomAction
type FileHandleProto = CmdHubProto.FileHandle

/** Minimal event-emitter surface adaptService needs. Loose-typed so concrete
 *  services using a TypedEventEmitter (narrow event map) are still assignable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EventSource {
    on(event: string, listener: (...args: any[]) => void): unknown
    off(event: string, listener: (...args: any[]) => void): unknown
}

export type InvokeWriter = (msg: InvokeServer) => void

/** Soft cap on a single envelope's payload_json size. gRPC's default
 *  per-message limit is 4MB; we cap well below that to leave headroom
 *  for the wire framing. Plugins that legitimately need larger payloads
 *  should chunk via `liveLog` or use the FileService grant path. */
const MAX_PAYLOAD_BYTES = 64 * 1024

/**
 * Wire a BaseCommandService-shaped EventEmitter into a gRPC-stream writer.
 * Every event the service emits becomes one InvokeServer message with a
 * monotonic `seq` field. Returns a `stop()` that removes all listeners.
 *
 * The service may emit a `file` event in two shapes:
 *   - a string path (rejected — nodes must upload bytes via FileService
 *     before emitting `file` with a handle; surfaces as a UiMessage with
 *     severity=error)
 *   - a FileHandle protobuf object (what the new code produces)
 */
export function adaptService(
    svc: EventSource,
    writer: InvokeWriter,
    nodeUiMessageRegistry: INodeUiMessageRegistry,
): () => void {
    let seq = 0

    const writeUiMessage = (msg: UiMessage): void => {
        const plugin = nodeUiMessageRegistry.lookup(msg.kind)
        if (!plugin) {
            // Service emitted a kind not registered. Don't crash the stream;
            // surface a text fallback so the operator sees what happened.
            const fallback = `[unregistered UiMessage kind: ${msg.kind}]`
            log.warn(`event-adapter: ${fallback} — call app.useUiMessageKind(...) at boot`)
            writer({ seq: ++seq, uiMessage: {
                kind: 'text',
                payloadJson: Buffer.from(JSON.stringify({ text: fallback })),
                severity: 'warn',
                compatibilityId: 'cmd-hub.builtin.text',
                version: '1.0.0',
            }})
            return
        }
        // Strip discriminator fields; everything else is the payload.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { kind, severity, ...payload } = msg as any
        const payloadBytes = Buffer.from(JSON.stringify(payload))
        if (payloadBytes.length > MAX_PAYLOAD_BYTES) {
            log.warn(`event-adapter: UiMessage kind="${kind}" payload exceeds ${MAX_PAYLOAD_BYTES} bytes (${payloadBytes.length}); refused`)
            writer({ seq: ++seq, uiMessage: {
                kind: 'text',
                payloadJson: Buffer.from(JSON.stringify({
                    text: `[oversized payload for kind "${kind}" (${payloadBytes.length} bytes); refused]`,
                })),
                severity: 'error',
                compatibilityId: 'cmd-hub.builtin.text',
                version: '1.0.0',
            }})
            return
        }
        writer({ seq: ++seq, uiMessage: {
            kind,
            payloadJson: payloadBytes,
            severity: severity ?? '',
            compatibilityId: plugin.compatibilityId,
            version: plugin.version,
        }})
    }

    const onUiMessage = (msg: UiMessage) => writeUiMessage(msg)

    const onProgress = (name: string, current: number, total: number) => {
        writer({ seq: ++seq, progress: { name, current, total } })
    }
    const onProgressStatus = (name: string, status: string) => {
        writer({ seq: ++seq, progressStatus: { name, status } })
    }
    const onIntercom = (actions: IntercomAction[]) => {
        writer({ seq: ++seq, intercom: { actions: actions ?? [] } })
    }
    const onFile = (handleOrPath: FileHandleProto | string) => {
        if (typeof handleOrPath === 'string') {
            // The node violated the FileHandle contract — surface as a
            // text-severity-error UiMessage so the dashboard renders it
            // through the same channel as any other operator-visible
            // failure.
            writeUiMessage({
                kind: 'text',
                severity: 'error',
                text:
                    `node emitted a file-path event (${handleOrPath}) but only FileHandle is supported; ` +
                    `upload bytes via FileService.issueWriteGrant first.`,
            })
            return
        }
        writer({ seq: ++seq, file: { handle: handleOrPath } })
    }
    const onLiveLog = (lines: string[]) => {
        writer({ seq: ++seq, liveLog: { lines: lines ?? [] } })
    }
    const onDone = (finalMessage?: string) => {
        writer({ seq: ++seq, done: { finalMessage: finalMessage ?? '' } })
    }

    svc.on('uiMessage', onUiMessage)
    svc.on('progress', onProgress)
    svc.on('progressStatus', onProgressStatus)
    svc.on('intercom', onIntercom)
    svc.on('file', onFile)
    svc.on('liveLog', onLiveLog)
    svc.on('done', onDone)

    return () => {
        svc.off('uiMessage', onUiMessage)
        svc.off('progress', onProgress)
        svc.off('progressStatus', onProgressStatus)
        svc.off('intercom', onIntercom)
        svc.off('file', onFile)
        svc.off('liveLog', onLiveLog)
        svc.off('done', onDone)
    }
}
