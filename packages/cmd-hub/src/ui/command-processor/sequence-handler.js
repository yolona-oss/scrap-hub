"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandSequenceHandler = void 0;
const stack_1 = require("../../utils/struct/stack");
const built_in_cmd_enum_1 = require("./constants/built-in-cmd-enum");
class CommandSequenceHandler {
    sequences;
    handlingSeq;
    constructor(data) {
        this.sequences = new Map();
        this.handlingSeq = data.map(item => {
            const cur = {
                target: item.target,
                prev: item.prev ? [item.prev] : [],
                next: item.next || []
            };
            let iterPrev = data.find(itm => itm.target == item.prev);
            for (iterPrev; iterPrev; iterPrev = data.find(itm => itm.target == iterPrev?.prev)) {
                cur.prev.unshift(iterPrev.target);
            }
            cur.prev = cur.prev.filter((v, i, a) => a.indexOf(v) == i);
            return cur;
        });
    }
    handleBuiltInSeqCommands(command, selSequence, seqId) {
        switch (command) {
            case built_in_cmd_enum_1.BuiltInSeqCommandsEnum.NEXT_COMMAND:
                break;
            case built_in_cmd_enum_1.BuiltInSeqCommandsEnum.BACK_COMMAND:
                if (selSequence) {
                    if (selSequence.size() > 0) {
                        const prevCmd = this.sequences.get(String(seqId)).pop();
                        return {
                            success: true,
                            markup: {
                                text: `You are backed to "${prevCmd}".`
                            }
                        };
                    }
                }
                return {
                    success: false,
                    markup: {
                        text: "You are not in a command sequence."
                    }
                };
            case built_in_cmd_enum_1.BuiltInSeqCommandsEnum.CANCEL_COMMAND:
                if (selSequence) {
                    this.sequences.get(String(seqId)).drop();
                    return {
                        success: true,
                        markup: {
                            text: "Sequence canceled."
                        }
                    };
                }
                return {
                    success: false,
                    markup: {
                        text: "You are not in a command sequence."
                    }
                };
            default:
                break;
        }
        return {
            success: true,
            skip: true,
            markup: { text: `You are not in a command sequence.` }
        };
    }
    addToSeq(seqId, target) {
        this.sequences.get(seqId).push(target);
    }
    dropSeq(seqId) {
        this.sequences.get(seqId).drop();
    }
    includesInSeq(seqId, targets) {
        const notIncludes = [];
        for (const target of targets) {
            if (!this.sequences.get(seqId).includes(target)) {
                notIncludes.push(target);
            }
        }
        return notIncludes;
    }
    handle(seqId, command) {
        seqId = String(seqId);
        const selSequence = this.sequences.get(seqId);
        const handlingSeq = this.handlingSeq.find((item) => item.target === command);
        const res = this.handleBuiltInSeqCommands(command, selSequence, seqId);
        if (!res.skip) {
            const { markup, success } = res;
            return { markup, success };
        }
        if (!selSequence) {
            this.sequences.set(seqId, new stack_1.Stack());
        }
        if (!handlingSeq) {
            return {
                success: false,
                markup: {
                    text: `Unknown command "${command}".`
                }
            };
        }
        const curHandlingSeq = this.handlingSeq.find((item) => item.target === command);
        if (curHandlingSeq.prev.length == 0 && curHandlingSeq.next.length == 0) {
            return;
        }
        const notExecuted = this.includesInSeq(seqId, curHandlingSeq.prev);
        if (notExecuted.length == 0) {
            this.addToSeq(seqId, command);
        }
        else {
            return {
                success: false,
                markup: {
                    text: `You are not executed all prev commands(${notExecuted.length}): ${notExecuted.join(', ')}.`
                }
            };
        }
        if (curHandlingSeq.next.length === 0) {
            this.dropSeq(seqId);
            return;
        }
        return;
    }
}
exports.CommandSequenceHandler = CommandSequenceHandler;
