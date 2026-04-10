export interface IChainHandler<Request, Responce> {
    setNext(handler: IChainHandler<Request, Responce>): IChainHandler<Request, Responce>
    handle(request: Request): Responce
}

interface IChain {
    handle(request: any): any
    drop(): void
    setFallThrowResponse(res: any): void
    use(handler: IChainHandler<any, any>): void
    useFirst(handler: IChainHandler<any, any>): void
    useMany(handlers: IChainHandler<any, any>[]): void
}

export class Chain<Request, Response> implements IChain {
    private handlers: IChainHandler<Request, Response>[] = []
    private fallThrowRes: Response = {} as Response

    get Handlers() {
        return this.handlers
    }

    use(handler: IChainHandler<Request, Response>): void {
        if (this.handlers.length > 0) {
            this.handlers[this.handlers.length - 1].setNext(handler)
        }
        this.handlers.push(handler)
    }

    useFirst(handler: IChainHandler<Request, Response>): void {
        if (this.handlers.length > 0) {
            handler.setNext(this.handlers[0])
        }
        this.handlers.unshift(handler)
    }

    useMany(handlers: IChainHandler<Request, Response>[]): void {
        handlers.forEach(handler => this.use(handler))
    }

    drop() {
        //this.handlers = []
        //this.fallThrowRes = {} as Response
    }

    setFallThrowResponse(res: Response): void {
        this.fallThrowRes = res
    }

    handle(request: Request): Response {
        if (this.handlers.length > 0) {
            return this.handlers[0].handle(request)
        }

        return this.fallThrowRes
    }
}

/**
 * Sync chain handler factory
 */
export function chainHandlerFactory<Request, Response>(
    handler: (this: typeof thisArg, request: Request) => Response|void, thisArg?: any
): IChainHandler<Request, Response> {
    let next: IChainHandler<Request, Response> | null = null

    return {
        setNext(handler: IChainHandler<Request, Response>): IChainHandler<Request, Response> {
            next = handler
            return next
        },
        handle(request: Request): Response {
            const handled = handler.call(thisArg, request)
            if (handled !== undefined) {
                return handled
            }

            if (next) {
                return next.handle(request)
            }

            return undefined as unknown as Response
        }
    }
}

/**
 * Use as last in chain hanler to return fallback value
 */
export function createChainFallbackHandler<Request, Response>(
    fallbackValue: Response
): IChainHandler<Request, Response> {
    return chainHandlerFactory<Request, Response>(
        function (): Response {
            return fallbackValue
        }
    )
}
