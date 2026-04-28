// Test-time chalk shim. The real package is ESM-only; in tests we don't
// care about ANSI colors, so we expose a Proxy that pretends every chain
// (e.g. `chalk.yellow.bold`) is an identity stylizer.

type Stylizer = ((...args: unknown[]) => string) & { [k: string]: Stylizer }

function makeStylizer(): Stylizer {
    const fn = ((...args: unknown[]) => args.join(' ')) as Stylizer
    return new Proxy(fn, {
        get: (target, prop) => {
            if (typeof prop === 'string' && !(prop in target)) return makeStylizer()
            return Reflect.get(target, prop)
        },
    })
}

const stub = makeStylizer()
export default stub
export type ColorName = string
