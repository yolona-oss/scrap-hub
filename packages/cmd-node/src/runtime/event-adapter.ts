import { EventEmitter } from 'events'
import type {
    InvokeServer,
    IntercomAction,
    FileHandle as FileHandleProto,
} from '@core/grpc/generated/cmd_node'

export type InvokeWriter = (msg: InvokeServer) => void

/**
 * Wire a BaseCommandService-shaped EventEmitter into a gRPC-stream writer.
 * Every event the service emits becomes one InvokeServer message with a
 * monotonic `seq` field. Returns a `stop()` that removes all listeners.
 *
 * The service may emit a `file` event in two shapes:
 *   - a string path (legacy monolith shape — treated as an error; nodes must
 *     upload bytes via FileService before emitting `file` with a handle)
 *   - a FileHandle protobuf object (what the new code produces)
 *
 * The adapter forwards the second shape and converts the first into a
 * StreamError so the consumer can tell immediately that the node violated
 * the file-handle contract.
 */
export function adaptService(svc: EventEmitter, writer: InvokeWriter): () => void {
    let seq = 0

    const onMessage = (text: string) => {
        writer({ seq: ++seq, message: { text: String(text) } })
    }
    const onError = (text: string) => {
        writer({ seq: ++seq, error: { text: String(text) } })
    }
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
            writer({
                seq: ++seq,
                error: {
                    text:
                        `node emitted a file-path event (${handleOrPath}) but only FileHandle is supported; ` +
                        `upload bytes via FileService.issueWriteGrant first.`,
                },
            })
            return
        }
        writer({ seq: ++seq, file: { handle: handleOrPath } })
    }
    const onDone = (finalMessage?: string) => {
        writer({ seq: ++seq, done: { finalMessage: finalMessage ?? '' } })
    }

    svc.on('message', onMessage)
    svc.on('error', onError)
    svc.on('progress', onProgress)
    svc.on('progressStatus', onProgressStatus)
    svc.on('intercom', onIntercom)
    svc.on('file', onFile)
    svc.on('done', onDone)

    return () => {
        svc.off('message', onMessage)
        svc.off('error', onError)
        svc.off('progress', onProgress)
        svc.off('progressStatus', onProgressStatus)
        svc.off('intercom', onIntercom)
        svc.off('file', onFile)
        svc.off('done', onDone)
    }
}
