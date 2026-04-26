import 'reflect-metadata'

/** Read/write decorator metadata under a symbol key. One helper for every
 *  decorator's storage; replaces the hand-rolled `Reflect.defineMetadata`
 *  + `Reflect.getMetadata` pairs in the per-decorator files. */
export function defineDecoratorMeta<T>(key: symbol, target: object, meta: T): void {
    Reflect.defineMetadata(key, meta, target)
}

export function readDecoratorMeta<T>(key: symbol, target: object): T | null {
    return Reflect.getMetadata(key, target) ?? null
}

/** Metadata key namespace. All cmd-hub decorator keys go through this so
 *  the symbol naming stays consistent: `Symbol.for('cmd-hub.<Decorator>')`. */
export function makeMetaKey(decoratorName: string): symbol {
    return Symbol.for(`cmd-hub.${decoratorName}`)
}
