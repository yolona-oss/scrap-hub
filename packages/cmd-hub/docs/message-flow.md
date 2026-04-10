# Message Flow & Lifecycle Documentation

## Message Types

| Type | TTL | Trigger for deletion | Description |
|------|-----|---------------------|-------------|
| `result` | never | only `/wipe_chat` | Command execution results the user wants to keep |
| `system` | 60s auto | timer or `/wipe_chat` | Errors, notifications, lifecycle messages |
| `builder` | on build complete | 5s after build done/cancel | Builder markup messages, user input during build |
| `dashboard` | on service end | `detach()` keeps snapshot; `destroy()` removes | Service dashboard editable message |

## Message Sending Paths

### Path 1: Command Handler Chain → replyByCommandResult()

```
User types /command
  → TelegramUI.handleInput()
    → dispatcher.handleCommand()
      → Handler Chain: Alias → Builder → Sequence → Invokation
        → returns IHandleResult { success, markup, messageType? }
    → TelegramUI.replyByCommandResult(ctx, result)
      → deleteBuilderMessage() (removes previous builder msg)
      → ctx.reply(text, keyboard?)
      → lifecycle.track(userId, msgId, messageType ?? inferred)
```

**messageType inference**: if handler sets `messageType`, that's used. Otherwise: has buttons → `'builder'`, no buttons → `'result'`.

**How to control**: Any command function or built-in command returns `messageType` in the result:
```typescript
return { success: true, markup: { text: "temporary" }, messageType: 'system' }
```

### Path 2: Builder Interactive Flow

```
/command (needs args) → HandleCmdBuilder.startNewBuild()
  → CommandBuilder.startBuild() → BuilderMarkuper.__tmpMarkup()
  → returns IHandleResult { markup, messageType: 'builder' }
  → replyByCommandResult() tracks as 'builder'

User clicks button → bot.action("builder_*")
  → dispatcher.handleCommand(action)
  → HandleCmdBuilder.handleBuildProcess()
    → builder.handle() → interpreter.step()
    → returns IHandleResult { markup, messageType: 'builder' }
  → replyByCommandResult() deletes prev builder msg, sends new one

Build completes (stepRes.IsCompiled):
  → lifecycle.scheduleCleanupByType(userId, 'builder', 5000)
  → dispatcher.CommandInvoker.invoke() → returns result
  → All builder messages deleted 5s later

Build cancelled (stepRes.Done without IsCompiled):
  → lifecycle.scheduleCleanupByType(userId, 'builder', 5000)
```

**User input during build**: text messages tracked as `'builder'` (cleaned with build messages).

### Path 3: Service Invocation (with Dashboard)

```
Builder completes → CommandInvoker.invokeService()
  → serviceInstance.Initialize()
  → ServiceDashboard created
  → dashboard.bindService() — subscribes to service events
  → dashboard.attach() — sends dashboard message via uiImpl.sendMessage()
  → serviceInstance.run() (fire-and-forget)

Service running:
  → service.emit("message") → dashboard.appendLine('message', msg)
  → service.emit("error") → dashboard.appendLine('error', msg)
  → service.emit("liveLog") → dashboard.appendLine('log', ...)
  → dashboard.scheduleRender() → 500ms debounce → editMessage()

Service ends:
  → service.emit("done") → dashboard detach()
  → Dashboard message kept as final snapshot (buttons removed)
  → User can /dashboard <name> to re-foreground it

Explicit close:
  → /wipe_chat → dispatcher.destroyAllDashboards() → deleteMessage()
```

### Path 4: Service Invocation (without Dashboard, -noDashboard)

```
CommandInvoker.invokeService() with noDashboard:
  → serviceInstance.on("message") → ctx.reply(message) [NOT tracked]
  → serviceInstance.on("done") → ctx.reply("done") [NOT tracked]
  → serviceInstance.run().catch() → ctx.reply(error) [NOT tracked]
```

**Known issue**: these ctx.reply calls bypass lifecycle tracking and plugin hooks.

### Path 5: Built-in Telegram Commands

```
/start, /setname, /status, etc.
  → TelegramUI.setCommandHandler() → bot.command(cmd, handler)
  → handler calls ctx.reply() directly
  → Does NOT go through replyByCommandResult()
```

**Known issue**: these bypass lifecycle tracking and plugin hooks. They use `ctx.reply()` directly instead of returning `IHandleResult`.

### Path 6: Auth Flow

```
New user sends message → setupAuth() middleware
  → ctx.replyWithMarkdownV2("Welcome...") [NOT tracked]

User clicks "Send" approval button → sendJoinRequestToAdmin()
  → ctx.telegram.sendMessage(admin_id, "Approve request...") [NOT tracked]

Admin clicks Approve → approveJoinRequest()
  → bot.telegram.sendMessage(userId, "accepted") [NOT tracked]

Admin clicks Reject → rejectJoinRequest()
  → bot.telegram.sendMessage(userId, "rejected") [NOT tracked]
```

**Known issue**: all auth messages bypass lifecycle, plugin hooks, and error handling.

### Path 7: System Notifications

```
Bot startup → notifyManagers("Service now online")
  → bot.telegram.sendMessage() → lifecycle.track('system')

Bot shutdown → notifyManagers("Service going offline")
  → bot.telegram.sendMessage() → lifecycle.track('system')

Global error → bot.catch()
  → ctx.reply(error) → lifecycle.track('system')

Command error → handleInput() catch
  → ctx.reply(error) → lifecycle.track('system')
```

### Path 8: Dashboard Buttons

```
User clicks dashboard button → bot.action("svc_dash_*")
  → dashboard.handleCallback(action)
    → toggle_message/error/log → toggleChannel() → scheduleRender()
    → pause/resume/stop → service.receiveMsg()
  → ctx.answerCbQuery() (Telegram notification, no message)
```

### Path 9: Calibrate Command

```
/calibrate → CalibrateCommand.invokable()
  → uiImpl.sendMessage(text, buttons) [tracked via plugin hook]

User clicks width button → bot.action("calibrate_*")
  → handleCalibrationCallback() → save to Manager.messageWidth
  → ctx.answerCbQuery(result) → ctx.deleteMessage()
```

## Lifecycle Persistence

```
On message tracked:
  → In-memory Map + setTimeout for TTL
  → PendingDelete.updateOne() (MongoDB persist)

On message deleted:
  → clearTimeout + remove from Map
  → PendingDelete.deleteOne()

On graceful shutdown (terminate()):
  → lifecycle.persistAll() → saves all tracked messages to DB

On startup (run()):
  → lifecycle.restoreAndCleanup() → loads from DB, deletes messages, clears DB

On crash (no graceful shutdown):
  → Messages were persisted on track(), so next startup recovers them
```

## Known Issues & Gaps

### CRITICAL
1. **Service fallback messages (noDashboard mode)** — ctx.reply in event handlers bypass lifecycle tracking, plugin hooks, and error handling
2. **Built-in TG commands** — all use ctx.reply directly, bypass lifecycle and plugins
3. **Auth flow messages** — bypass everything, no error handling

### HIGH
4. **deleteBuilderMessage vs lifecycle race** — both can try to delete the same message; builderMessageIds Map only stores the last message, previous ones leak
5. **Service event handler errors** — ctx.reply in event handlers has no try-catch

### MEDIUM
6. **Sticker send in notifyManagers** — not tracked, not awaited properly
7. **Welcome message in setupAuth** — not tracked
8. **Dashboard edit on deleted message** — editMessage silently fails if message was deleted

## Command Reference

### Built-in SDK Commands

| Command | Type | Description |
|---------|------|-------------|
| `/help` | function | Show all available commands |
| `/chelp <cmd>` | function | Show detailed help for a command |
| `/stop <service>` | function | Stop a running service |
| `/run <service>` | function | Run a service without builder (no config) |
| `/msg <service> <msg>` | function | Send message to running service |
| `/services` | function | List all registered and active services |
| `/dashboard [service]` | function | Show/foreground service dashboard |
| `/calibrate` | function | Calibrate message display width |
| `/setv <key> <value>` | function | Set account variable |
| `/getv <key>` | function | Get account variable |
| `/remove <key>` | function | Remove account variable |
| `/alias <name> <cmd>` | function | Create command alias |
| `/unalias <name>` | function | Remove command alias |
| `/list_aliases` | function | List all aliases |
| `/next` | sequence | Go to next command in sequence |
| `/back` | sequence | Go to previous command in sequence |
| `/cancel` | sequence | Cancel current sequence |

### Built-in Telegram Commands (registered via TelegramUI)

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/setname <name>` | Set display name |
| `/setavatar` | Set avatar from account |
| `/go_offline` | Set status offline |
| `/go_online` | Set status online |
| `/status` | Show current status |
| `/setgreeting <on/off>` | Toggle startup greeting |
| `/wipe_chat` | Delete all chat messages |

## Service Lifecycle

```
Registration:
  new MyService() → registered in dispatcher via registerMany()

User invokes /service_name:
  1. Builder starts (collects args via inline buttons)
  2. Builder completes → CommandInvoker.invokeService()
  3. Service cloned for user: exe.clone(userId, inputData)
  4. service.Initialize() → loads session from MongoDB
  5. Dashboard created and attached (unless -noDashboard)
  6. service.run() → fire-and-forget (runWrapper executes)

Running:
  - service.emit("message", msg) → dashboard or ctx.reply
  - service.emit("error", err) → dashboard or ctx.reply
  - service.emit("liveLog", logs) → dashboard
  - user sends /msg <service> <cmd> → service.receiveMsg(cmd, args)

Termination:
  - service.terminate() → terminateWrapper() → emit("done")
  - Dashboard detaches (keeps final snapshot)
  - Service removed from active list
  - Session data persisted to MongoDB

Resume:
  - /service_name -s <sessionId> → loads previous session data
  - runWrapper() can check this.data.sessionData for state
```

## Builder / Interpreter

### Argument Types

| Type | Button prefix | Token type | Example |
|------|--------------|------------|---------|
| pair | `--` | DOUBLE_DASH | `--city Moscow` |
| standalone | `-` | SINGLE_DASH | `-dryRun` (toggle) |
| positional | `--` (in buttons) | DOUBLE_DASH → wait for TEXT | `--query` then user types value |

### Builder States

```
IDLE → user clicks arg button
  → WAIT_NEXT_V → transitByBuf
    → PAIR → setPairName → PAIR_VALUE → user types value → setPairValue → IDLE
    → POSITIONAL → user types value → setPositional → IDLE
    → STAND_ALONE → setStandalone (toggle) → IDLE
  → ARG_CTX_SEL → user clicks context → ctx-switch → IDLE
```

### Argument Contexts

| Context | Used for | When shown |
|---------|----------|------------|
| `config` | Service configuration (persistent) | Before service starts |
| `params` | Session parameters (sessionId, flags) | Before service starts |
| `message` | Interactive commands (pause, stop) | While service is running |
| `args` | Function command arguments | For non-service commands |

All contexts shown simultaneously in builder buttons. Parser auto-switches context when user clicks an arg from a different context.

## Auto-Delete Behavior

| Scenario | What's deleted | When |
|----------|---------------|------|
| Builder step | Previous builder message | Immediately on next step |
| Build complete | All builder messages + user input | 5s after completion |
| Build cancel | All builder messages + user input | 5s after cancel |
| System message | The message itself | 60s after send |
| Service ends | Dashboard buttons removed | Immediately (message kept as snapshot) |
| `/dashboard <name>` | Old dashboard message | Immediately (new one sent) |
| `/wipe_chat` | Everything: history + lifecycle + dashboards | Immediately |
| App restart | Pending deletes from previous session | On startup |
| Unrecognized text | User's message | 60s (tracked as system) |
