/** Severity hint a UI may use to colorize / icon-prefix a rendered message.
 *  Renderers MUST tolerate `undefined` and renderers MAY ignore it (e.g.
 *  the CLI fallback for `info` is just plain output). */
export type UiSeverity = 'info' | 'warn' | 'error' | 'success'

export interface UiMessageBase {
    /** Wire discriminator. Same string flows through capability keys
     *  (`uiMessageKindCap(kind)`) and the proto envelope's `kind` field. */
    kind: string
    severity?: UiSeverity
}

/** Built-in kinds the framework guarantees for every UI. Plugins extend
 *  this map via TS declaration merging (see `CustomUiMessageKinds`). */
export interface BuiltinUiMessageKinds {
    'text':     { text: string }
    'markdown': { md: string }
    'code':     { code: string, language?: string }
    'list':     { items: UiMessage[] }
    'kv':       { pairs: Array<{ key: string, value: string }> }
    'link':     { text: string, url: string }
}

/** Open extension point. Plugin packages augment this via:
 *  ```ts
 *  declare module '@cmd-hub/common' {
 *      interface CustomUiMessageKinds {
 *          'org': { name: string, phone?: string|null, ... }
 *      }
 *  }
 *  ```
 *  After augmentation the corresponding kind shows up in `UiMessage`
 *  everywhere downstream. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CustomUiMessageKinds {}

export type UiMessageKindMap = BuiltinUiMessageKinds & CustomUiMessageKinds

/** The full discriminated union resolved at compile time from builtin +
 *  plugin-augmented kinds. Use as the canonical type when emitting or
 *  receiving messages. */
export type UiMessage = {
    [K in keyof UiMessageKindMap]: UiMessageBase & { kind: K } & UiMessageKindMap[K]
}[keyof UiMessageKindMap]
