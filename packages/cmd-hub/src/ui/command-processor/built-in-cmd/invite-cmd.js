"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InviteCommand = void 0;
const constants_1 = require("../constants");
const command_1 = require("../../../ui/types/command");
const ui_1 = require("../../../ui");
const table_designer_1 = require("../../../utils/table-designer");
const common_1 = require("@cmd-hub/common");
const crypto_1 = __importDefault(require("crypto"));
class InviteArgs {
    list;
    expires;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: false,
        standalone: true,
        description: "List all invitation links"
    }),
    __metadata("design:type", String)
], InviteArgs.prototype, "list", void 0);
__decorate([
    (0, command_1.CmdArgument)({
        required: false,
        description: "Expiration time (e.g. 1h, 24h, 7d). Empty = no expiry",
        pairOptions: ['1h', '24h', '7d', '30d'],
    }),
    __metadata("design:type", String)
], InviteArgs.prototype, "expires", void 0);
function parseExpiry(str) {
    if (!str)
        return undefined;
    const match = str.match(/^(\d+)(m|h|d)$/);
    if (!match)
        return undefined;
    const n = parseInt(match[1]);
    switch (match[2]) {
        case 'm': return n * 60 * 1000;
        case 'h': return n * 60 * 60 * 1000;
        case 'd': return n * 24 * 60 * 60 * 1000;
        default: return undefined;
    }
}
exports.InviteCommand = {
    command: constants_1.BuiltInUiCommandsEnum.INVITE,
    description: "Create or list invitation links (admin only)",
    args: new InviteArgs,
    requires: [common_1.CAP_InvitationLinkRepo],
    invokable: async function (args, ctx) {
        if (!ctx.manager?.isAdmin) {
            await ctx.reply(`${ui_1.UiUnicodeSymbols.error} Admin access required`);
            return;
        }
        const repo = this.requireRepos('invite').invitationLink;
        const doList = args.has('list');
        if (doList) {
            const links = await repo.listRecent(20);
            if (links.length === 0) {
                await ctx.reply(`${ui_1.UiUnicodeSymbols.info} No invitation links yet.`);
                return;
            }
            const designer = new table_designer_1.TableDesigner();
            const table = designer.make({
                title: `${ui_1.UiUnicodeSymbols.gear} Invitation links`,
                header: ['Token', 'Used', 'Used By', 'Expires'],
                body: links.map(l => [
                    l.token.slice(0, 8) + '...',
                    l.used ? 'yes' : 'no',
                    l.usedBy ? String(l.usedBy) : '-',
                    l.expiresAt ? l.expiresAt.toISOString().slice(0, 16) : 'never',
                ]),
            }, ctx.manager?.messageWidth ?? 72);
            await ctx.reply(`<pre>${table}</pre>`, { parse_mode: 'HTML' });
            return;
        }
        const expiresStr = args.get('expires');
        const expiresMs = parseExpiry(expiresStr);
        const token = crypto_1.default.randomUUID();
        const expiresAt = expiresMs ? new Date(Date.now() + expiresMs) : undefined;
        await repo.create({ token, createdBy: ctx.manager.userId, expiresAt });
        const expiryText = expiresAt
            ? `expires ${expiresAt.toISOString().slice(0, 16)}`
            : 'no expiry';
        await ctx.reply(`${ui_1.UiUnicodeSymbols.success} Invitation created (${expiryText})\n\n` +
            `Token: ${token}\n` +
            `Web link: /invite/${token}`);
    }
};
