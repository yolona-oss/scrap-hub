import { adaptService, type InvokeWriter } from 'cmd-node/src/runtime/event-adapter'
import type { InvokeExecutor } from 'cmd-node/src/runtime/invoke-server'
import type { IntercomReceiver } from 'cmd-node/src/runtime/intercom-dispatch'
import type { ScraperServiceDataType } from './scraper-service/service-data'
import type { OrgScraperService } from './scraper-service/service'

export interface ScraperExecutorDeps {
    /**
     * Construct a fresh OrgScraperService for the given (userId, inputData).
     * Called once per incoming InvokeStart.
     */
    makeService: (userId: string, inputData: Partial<ScraperServiceDataType>) => OrgScraperService
    /** Resolver for 'all' sources (Phase-0 FakeSource registration lives here too). */
    availableSources: () => string[]
}

/**
 * Bridge between the node-runtime's InvokeExecutor shape and the
 * BaseCommandService lifecycle that OrgScraperService inherits:
 *
 *   1. Parse InvokeStart.args into ScraperServiceDataType config/params.
 *   2. Instantiate the service.
 *   3. Wire its EventEmitter to the gRPC writer via adaptService.
 *   4. Initialize() against Mongo, then run() asynchronously.
 *   5. Return a receiver that forwards intercom actions to service.receiveMsg.
 */
export function buildScraperExecutor(deps: ScraperExecutorDeps): InvokeExecutor {
    return async (start, writer: InvokeWriter) => {
        const inputData = parseScraperArgs(start.args, deps.availableSources)

        const service = deps.makeService(start.userId, inputData)
        // The service extends typed-emitter's EventEmitter<EvMap>, whose
        // stricter key types aren't structurally compatible with Node's plain
        // EventEmitter<any> signature that adaptService expects. The runtime
        // behavior is identical; this cast is the narrow seam.
        const stopAdapter = adaptService(service as unknown as import('events').EventEmitter, writer)

        const receiver: IntercomReceiver = {
            async receiveMsg(actionId, args) {
                await service.receiveMsg(actionId, args)
            },
        }

        const done = (async () => {
            try {
                await service.Initialize()
                await service.run()
            } catch (err) {
                writer({ seq: 0, error: { text: (err as Error).message } })
                writer({ seq: 0, done: { finalMessage: '' } })
            }
        })()

        return { receiver, stopAdapter, done }
    }
}

function parseScraperArgs(
    args: Record<string, string>,
    availableSources: () => string[],
): Partial<ScraperServiceDataType> {
    const query = args.query ?? ''
    const city = args.city ?? ''
    const limit = args.limit ?? '100000'
    const format = args.format ?? 'csv'
    const sources = args.sources ?? 'all'

    const sourceNames = sources === 'all'
        ? availableSources()
        : sources.split(',').map((s) => s.trim()).filter(Boolean)

    // ScraperConfigData (GlobalServiceConfig subclass) carries query/city/
    // limit/format/sources; GlobalServiceParam is left with its default shape.
    // Cast via unknown to satisfy the decorated class types without widening
    // the ScraperServiceDataType signature.
    return {
        config: {
            query, city, limit, format,
            sources: sourceNames.join(','),
        } as unknown as Partial<ScraperServiceDataType>['config'],
        params: {} as unknown as Partial<ScraperServiceDataType>['params'],
        messages: {} as unknown as Partial<ScraperServiceDataType>['messages'],
    }
}
