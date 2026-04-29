/**
 * Session-id helpers used by `HubGlobalServiceArgs`.
 *
 * `sessionIdValidator` keeps user-supplied session names alphanumeric only —
 * mongo-safe and URL-safe. The function-form options resolvers
 * (`sessionOpts` / `sessionOptsWithRand`) that previously fed Telegram
 * autocomplete are gone: the new tree-native arg model only ships static
 * option lists over the wire, and "list this user's active sessions" is a
 * runtime query that doesn't fit. UIs that want session autocompletion
 * should surface it through their own affordances.
 */

export const sessionIdValidator = (v: string) => Boolean(v.match(/^[0-9a-zA-Z]+$/))
