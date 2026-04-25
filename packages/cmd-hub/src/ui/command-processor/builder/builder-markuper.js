"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuilderMarkuper = void 0;
const ui_1 = require("../../../ui");
const default_markup_1 = require("./default-markup");
const default_callbacks_1 = require("./default-callbacks");
const d_text = {
    info: ""
};
const d_options = {};
class BuilderMarkuper {
    constructor() { }
    static toMarkup(opt) {
        return {
            text: opt.text,
            type: opt.type,
            isRead: opt.isRead ?? false,
            data: opt.data ?? opt.text
        };
    }
    static BuildingString(state, info = "", addTo = "end", savedData) {
        const command = state.command;
        info = info.length > 1 ? `${ui_1.UiUnicodeSymbols.info} - ${info}` : "";
        const userSetNames = new Set(state.arguments.map(a => a.name));
        const settedArgToStr = (arg) => {
            const icon = arg.ctx === "message" ? ui_1.UiUnicodeSymbols.mail : ui_1.UiUnicodeSymbols.gear;
            return ` - ${icon} ${arg.name}: ${arg.value} ${ui_1.UiUnicodeSymbols.check}`;
        };
        const argGroupToString = (name, group) => {
            let str = `\n* ${name}:`;
            for (const arg of group) {
                str += '\n' + settedArgToStr(arg);
            }
            return str;
        };
        const args = state.arguments.filter(arg => arg.ctx === "args");
        const configs = state.arguments.filter(arg => arg.ctx === "config");
        const params = state.arguments.filter(arg => arg.ctx === "params");
        const messages = state.arguments.filter(arg => arg.ctx === "message");
        let buildStr = `${ui_1.UiUnicodeSymbols.hammer} Building "${command}"\n`;
        buildStr += args.length > 0 ? argGroupToString("Arguments", args) : '';
        buildStr += configs.length > 0 ? argGroupToString("Config", configs) : '';
        buildStr += params.length > 0 ? argGroupToString("Params", params) : '';
        buildStr += messages.length > 0 ? argGroupToString("Messages", messages) : '';
        if (savedData) {
            const unsetSaved = [];
            for (const key in savedData) {
                if (!userSetNames.has(key) && savedData[key] !== undefined && savedData[key] !== null && savedData[key] !== '') {
                    const val = String(savedData[key]).slice(0, 35);
                    unsetSaved.push(` - ${ui_1.UiUnicodeSymbols.info} ${key}: ${val} (saved)`);
                }
            }
            if (unsetSaved.length > 0) {
                buildStr += `\n\n${ui_1.UiUnicodeSymbols.lock} Saved defaults:\n${unsetSaved.join('\n')}`;
            }
        }
        if (addTo === "begining") {
            buildStr = `${info}\n\n${buildStr}`;
        }
        else if (addTo === "end") {
            buildStr = `${buildStr}\n\n${info}`;
        }
        return buildStr;
    }
    static __tmpMarkup(parser, savedData) {
        const desc = parser.toRawState().descriptor;
        const args = desc.args.filter(v => v.ctx === 'args');
        const msgs = desc.args.filter(v => v.ctx === 'message');
        const params = desc.args.filter(v => v.ctx === 'params');
        const configs = desc.args.filter(v => v.ctx === 'config');
        const stroke = (str, pair) => `${pair[0]}${str}${pair[1]}`;
        const formatArg = (v) => {
            const savedVal = savedData?.[v.name];
            const savedStr = savedVal !== undefined && savedVal !== '' && savedVal !== null
                ? ` = ${String(savedVal).length > 30 ? String(savedVal).slice(0, 27) + '...' : savedVal}`
                : '';
            return ` - ${stroke(v.name, v.required ? "<>" : "[]")}${savedStr} - ${v.description ?? "No description"}`;
        };
        let desc_str = "";
        [args, msgs, params, configs].forEach(descType => {
            desc_str += descType.map(formatArg).join('\n') + "\n";
        });
        let savedStr = "";
        if (savedData && Object.keys(savedData).length > 0) {
            savedStr = `\n${ui_1.UiUnicodeSymbols.info} Saved config will be applied:\n`;
            for (const key in savedData) {
                const val = savedData[key];
                if (val !== undefined && val !== null && val !== '') {
                    const display = typeof val === 'object' ? JSON.stringify(val).slice(0, 40) : String(val).slice(0, 40);
                    savedStr += `  ${key}: ${display}\n`;
                }
            }
        }
        const overwrite = `${ui_1.UiUnicodeSymbols.hammer} Run CmdBuilder\n
Building command: - ${ui_1.UiUnicodeSymbols.arrowRight} "${parser.Command}".\n
 - Avalible context: ${ui_1.UiUnicodeSymbols.arrowRight} ${parser.toRawState().avaliableCtxs.join(", ")}.\n${desc_str}${savedStr}`;
        return BuilderMarkuper.markup(parser, {
            text: {
                overwrite,
                info: "",
            },
        });
    }
    static markup(parser, { text, options }) {
        text = { ...d_text, ...text };
        options = { ...d_options, ...options };
        const infoText = Array.isArray(text.info) ? text.info.join('\n') : text.info;
        let auxButtons = default_markup_1.BuilderMarkups.default;
        let byStateButtons = [];
        if (parser.State === 'PAIR_VALUE') {
            const desc = parser.findDescriptorByName(parser.LastReadArg.name);
            byStateButtons = desc.pairOptions?.map(opt => this.toMarkup({
                text: `${opt}`,
                data: opt,
                type: 'value'
            })) ?? [];
            auxButtons = default_markup_1.BuilderMarkups.selection;
        }
        else if (parser.State === 'ARG_CTX_SEL') {
            byStateButtons = parser.AvaliableContexts.map(ctx => BuilderMarkuper.toMarkup({
                text: `${ctx}${parser.CurrentContext === ctx ? " " + ui_1.UiUnicodeSymbols.check : ""}`,
                data: ctx,
                type: "value",
                isRead: false
            }));
            auxButtons = default_markup_1.BuilderMarkups.selection;
        }
        else if (parser.State === 'WAIT_NEXT_V') {
            const type = parser.NextValueSetType;
            const val = parser.NextValueSetValue;
            if (type === 'standalone') {
                const isToggledOn = parser.isArgumentStandaloneRead(val);
                byStateButtons = [
                    this.toMarkup({
                        text: `Toggle-${isToggledOn ? "Off" : "On"}`,
                        type: 'value',
                        data: `-${val}`,
                    }),
                ];
                text.info += `Click to toggle standalone "${val}" to ${isToggledOn ? "Off" : "On"}`;
            }
            else if (type === 'positional') {
                const desc_l = parser.findDescriptorByName(val);
                if (!desc_l) {
                    throw new Error(`Cannot find descriptor for positional setted by next value setter handler: ${val}`);
                }
                text.info += `input positional(${desc_l.position}) value:`;
                if (desc_l.pairOptions && desc_l.pairOptions.length > 0) {
                    byStateButtons = desc_l.pairOptions.map(opt => this.toMarkup({
                        text: `${opt}`,
                        data: opt,
                        type: 'value'
                    }));
                    auxButtons = default_markup_1.BuilderMarkups.selection;
                }
                else {
                    byStateButtons = [];
                    auxButtons = [default_markup_1.BuilderMarkups.default.find(b => b.data === default_callbacks_1.BuilderActionSigns.cancelBuild)];
                }
            }
            else {
                throw new Error(`Unknown next value set type ${type}`);
            }
        }
        else {
            byStateButtons = parser.Descriptor.args.map(desc => {
                const isPair = desc.standalone == false && desc.position == null;
                const isStandalone = desc.standalone;
                return this.toMarkup({
                    text: `${desc.name}${parser.isArgumentRead(desc.name, desc.ctx) ? " " + ui_1.UiUnicodeSymbols.check : ""}`,
                    data: `${isStandalone ? '-' : '--'}${desc.name}`,
                    type: 'name',
                    isRead: parser.isArgumentNameRead(desc.name)
                });
            });
        }
        const mk_text = text.overwrite ?
            text.overwrite :
            this.BuildingString(parser.toRawState(), infoText, text.addTo, parser.SavedData);
        const mergedButtons = [
            ...byStateButtons,
            ...auxButtons,
            ...(options.extra_buttons ?? [])
        ];
        return {
            text: mk_text,
            buttons: mergedButtons
        };
    }
}
exports.BuilderMarkuper = BuilderMarkuper;
