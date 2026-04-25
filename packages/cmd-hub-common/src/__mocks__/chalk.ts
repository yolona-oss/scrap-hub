// Test-time chalk shim. The real package is ESM-only; in tests we don't care
// about ANSI colors, so identity-style passthrough functions are enough.

type Stylizer = (...args: unknown[]) => string

const identity: Stylizer = (...args) => args.join(' ')

const colorNames = [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'gray', 'grey',
    'blackBright', 'redBright', 'greenBright', 'yellowBright', 'blueBright',
    'magentaBright', 'cyanBright', 'whiteBright',
    'bold', 'dim', 'italic', 'underline', 'inverse', 'hidden', 'strikethrough',
] as const

const stub: Record<string, Stylizer> = { ...Object.fromEntries(colorNames.map(n => [n, identity])) }

export default stub
export type ColorName = string
