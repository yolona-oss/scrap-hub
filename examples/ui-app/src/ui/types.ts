import type { IUI, BaseUIContext } from '@cmd-hub/common'

/**
 * Per-UI factory. Each `./<kind>.ts` exports a `uiFactory` of this shape;
 * the active barrel (`./index.ts`) re-exports one of them so swapping
 * the deployment to a different UI is a single-line edit.
 *
 * The UI returned can be plain or a `.use(...)`-chained instance — the
 * `IUIWithUse` flavour is what `useUI` accepts. We keep the constraint
 * loose here since each plugin's chained type is its own.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UiFactory = () => IUI<BaseUIContext> | (IUI<BaseUIContext> & { onAppAttach?: any })
