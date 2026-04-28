import 'reflect-metadata'
import { z } from 'zod'
import {
    CmdArgument,
    CmdOneShot,
    type CmdOneShotContext,
    defineCapability,
} from '@cmd-hub/common'
import { CmdNodeApp } from '../cmd-node-app'

const CAP_GREETER = defineCapability<string>('test.greeter')

class GreetArgs {
    @CmdArgument({ required: false, position: 1, description: 'name', default: 'world' })
    name?: string
}

const GreetCommand = CmdOneShot({
    name: 'greet',
    description: 'emit a greeting',
    compatibilityId: 'com.example.greet',
    version: '1.0.0',
    argsClass: GreetArgs,
    requires: [CAP_GREETER],
    invokable: async (ctx: CmdOneShotContext<GreetArgs>) => {
        const greeting = ctx.require(CAP_GREETER)
        ctx.emit({ kind: 'message', text: `${greeting}, ${ctx.args.name ?? 'world'}` })
    },
})

const ThrowyCommand = CmdOneShot({
    name: 'throwy',
    description: 'always errors',
    compatibilityId: 'com.example.throwy',
    version: '1.0.0',
    invokable: async (_ctx) => {
        throw new Error('boom')
    },
})

function mkApp(name: string) {
    return new CmdNodeApp({
        configPath: '',
        nodeId: 'n-fn',
        nodeName: 'node-fn',
        version: '0.0.1',
        inlineConfig: {},
        baseSchema: z.object({}).passthrough(),
        name,
    })
}

describe('CmdNodeApp + CmdOneShot function commands', () => {
    it('useCommand accepts a CmdOneShotSpec and registers it under functionCommands', async () => {
        const app = mkApp(`fn-register-${Math.random().toString(36).slice(2)}`)
        app.useCommand(GreetCommand)
        expect(app.functionCommands.has('greet')).toBe(true)
        expect(app.services.has('greet')).toBe(false)
    })

    it('buildManifest emits a Command entry for the function command with its compatibilityId/version', async () => {
        const app = mkApp(`fn-manifest-${Math.random().toString(36).slice(2)}`)
        app.useCommand(GreetCommand)
        const manifest = await app.buildManifest()
        const greet = manifest.commands.find(c => c.name === 'greet')!
        expect(greet).toBeDefined()
        expect(greet.compatibilityId).toBe('com.example.greet')
        expect(greet.version).toBe('1.0.0')
        expect(greet.description).toBe('emit a greeting')
        // The new manifest carries one tree per command; for a one-shot
        // with `argsClass`, the root is a branch with one child per arg.
        expect(greet.options).toBeDefined()
        expect(greet.options!.branch).toBeDefined()
        expect(Object.keys(greet.options!.branch!.children)).toContain('name')
    })

    it('rejects duplicate command names across function commands and services', async () => {
        const app = mkApp(`fn-dup-${Math.random().toString(36).slice(2)}`)
        app.useCommand(GreetCommand)
        expect(() => app.useCommand(GreetCommand)).toThrow(/duplicate command name/)
    })

    it('Initialize fails when a function command requires a missing cap', async () => {
        const app = mkApp(`fn-validate-miss-${Math.random().toString(36).slice(2)}`)
        app.useCommand(GreetCommand)
        await expect(app.Initialize()).rejects.toThrow(/greet/)
    })

    it('end-to-end: function command runs through the executor, emits message + done', async () => {
        const app = mkApp(`fn-end2end-${Math.random().toString(36).slice(2)}`)
        app.useCommand(GreetCommand)
        app.use({
            phase: 10,
            install: (a) => { a.provide(CAP_GREETER, 'hello', 'TestMiddleware') },
        })
        await app.Initialize()

        const messages: string[] = []
        const errors: string[] = []
        let done = false
        await runViaExecutor(app, {
            commandName: 'greet',
            args: { name: 'Alice' },
            userId: 'u-1',
            sessionId: 's-1',
        }, (kind, text) => {
            if (kind === 'message') messages.push(text)
            else if (kind === 'error') errors.push(text)
            else if (kind === 'done') done = true
        })

        expect(messages).toEqual(['hello, Alice'])
        expect(errors).toEqual([])
        expect(done).toBe(true)

        await app.terminate()
    })

    it('end-to-end: function command that throws emits error + done', async () => {
        const app = mkApp(`fn-throw-${Math.random().toString(36).slice(2)}`)
        app.useCommand(ThrowyCommand)
        await app.Initialize()

        const messages: string[] = []
        const errors: string[] = []
        let done = false
        await runViaExecutor(app, {
            commandName: 'throwy',
            args: {},
            userId: 'u', sessionId: 's',
        }, (kind, text) => {
            if (kind === 'message') messages.push(text)
            else if (kind === 'error') errors.push(text)
            else if (kind === 'done') done = true
        })

        expect(messages).toEqual([])
        expect(errors).toEqual(['boom'])
        expect(done).toBe(true)

        await app.terminate()
    })
})

/** Drive a CmdNodeApp's executor end-to-end without spinning up the gRPC
 *  stack. Builds the executor, calls createService(start), wires the
 *  resulting RunnableService's events into the test callback, then calls
 *  run() and awaits 'done'. The 'message'/'error' kinds in `onEvent` are
 *  test-side aliases for severity= '' / 'error' on a uiMessage{kind:text}
 *  envelope. */
async function runViaExecutor(
    app: CmdNodeApp,
    start: { commandName: string; args: Record<string, string>; userId: string; sessionId: string },
    onEvent: (kind: 'message' | 'error' | 'done', text: string) => void,
): Promise<void> {
    interface ExposedApp {
        buildExecutor(): {
            createService(s: typeof start): Promise<{
                on(event: string, listener: (...args: unknown[]) => void): unknown
                run(): Promise<void>
            }>
        }
    }
    const exposed = app as unknown as ExposedApp
    const executor = exposed.buildExecutor()
    const svc = await executor.createService(start)

    const finished = new Promise<void>((resolve) => {
        svc.on('uiMessage', (msg: unknown) => {
            const m = msg as { kind?: string; text?: string; severity?: string }
            if (m?.kind === 'text') {
                const kind = m.severity === 'error' ? 'error' : 'message'
                onEvent(kind, String(m.text ?? ''))
            }
        })
        svc.on('done', () => { onEvent('done', ''); resolve() })
    })
    await svc.run()
    await finished
}
