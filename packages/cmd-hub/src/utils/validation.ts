/**
 * Validate a config/database path to prevent MongoDB operator injection
 * and prototype pollution.
 */
export function isValidConfigPath(path: string): boolean {
    return /^[a-zA-Z0-9_.]+$/.test(path)
        && !path.startsWith('$')
        && !path.includes('__proto__')
        && !path.includes('constructor')
        && !path.includes('prototype')
}
