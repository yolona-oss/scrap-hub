/* eslint-disable no-console */
// Rewritten in Phase 5.10 of the package-split plan — partial.
//
// The CmdHubApp bootstrap below typechecks through the middleware stack, but
// TelegramUI (at @cmd-hub/core/ui/impls/telegram) still takes a CmdDispatcher
// at construction time, which is a coupling point that Phase 5.7-5.9 (UI
// package split into @cmd-hub/ui-telegram) is designed to fix by turning
// TelegramUI into a parameterless ConfigContributor that wires itself to the
// hub in `onAppAttach(app)`.
//
// Until that lands, telegram-ui-app stays a stub. The scraper-node example
// is the working end-to-end verification of the new Phase 5 node runtime.
console.log('telegram-ui-app placeholder; rewrite pending UI package split (Phase 5.7-5.9)')
process.exit(1)
