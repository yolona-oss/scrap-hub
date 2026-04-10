import { BaseUIContext } from "./types/context"
import { IUI } from "./types/ui"
import { CmdDispatcher } from "./command-processor"

export type UIFactory<Ctx extends BaseUIContext> = (dispatcher: CmdDispatcher<Ctx>, options: any) => IUI<Ctx>

export class UIRegistry {
    private static factories = new Map<string, UIFactory<any>>()

    static register<Ctx extends BaseUIContext>(name: string, factory: UIFactory<Ctx>): void {
        UIRegistry.factories.set(name, factory)
    }

    static create<Ctx extends BaseUIContext>(name: string, dispatcher: CmdDispatcher<Ctx>, options?: any): IUI<Ctx> {
        const factory = UIRegistry.factories.get(name)
        if (!factory) {
            const available = Array.from(UIRegistry.factories.keys()).join(", ")
            throw new Error(`UIRegistry: unknown UI "${name}". Available: ${available}`)
        }
        return factory(dispatcher, options)
    }

    static has(name: string): boolean {
        return UIRegistry.factories.has(name)
    }

    static available(): string[] {
        return Array.from(UIRegistry.factories.keys())
    }
}
