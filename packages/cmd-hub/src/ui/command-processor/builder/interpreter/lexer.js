"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Lexer = void 0;
const logger_1 = __importDefault(require("../../../../application/logger"));
const DASHES = ['-', '—'];
class Lexer {
    input;
    pos = 0;
    currentChar;
    constructor() {
        this.input = '';
        this.pos = 0;
        this.currentChar = null;
    }
    setInput(input) {
        this.input = input;
        this.pos = 0;
        this.currentChar = this.input.length > 0 ? this.input[this.pos] : null;
    }
    advance() {
        this.pos++;
        this.currentChar = this.pos < this.input.length ? this.input[this.pos] : null;
    }
    skipWhitespace() {
        while (this.currentChar !== null && /\s/.test(this.currentChar)) {
            this.advance();
        }
    }
    text() {
        let result = '';
        while (this.currentChar !== null && !/\s/.test(this.currentChar)) {
            if (this.currentChar === '\\') {
                this.advance();
                if (this.currentChar !== null) {
                    result += this.currentChar;
                    this.advance();
                }
            }
            else if (this.currentChar === '"' || this.currentChar === "'") {
                const quote = this.currentChar;
                this.advance();
                while (this.currentChar !== null && this.currentChar !== quote) {
                    result += this.currentChar;
                    this.advance();
                }
                this.advance();
            }
            else {
                result += this.currentChar;
                this.advance();
            }
        }
        return { type: 'TEXT', value: result };
    }
    dash() {
        if (DASHES.includes(this.currentChar) && DASHES.includes(this.input[this.pos + 1])) {
            this.advance();
            this.advance();
            let result = '';
            while (this.currentChar !== null && !/\s/.test(this.currentChar)) {
                result += this.currentChar;
                this.advance();
            }
            return { type: 'DOUBLE_DASH', value: result };
        }
        else if (DASHES.includes(this.currentChar)) {
            this.advance();
            let result = '';
            while (this.currentChar !== null && !/\s/.test(this.currentChar)) {
                result += this.currentChar;
                this.advance();
            }
            return { type: 'SINGLE_DASH', value: result };
        }
        logger_1.default.error(`CBLexer::dash: Unexpected character after dash: "${this.currentChar}"`);
        throw new Error('Unexpected character after dash');
    }
    tokenizeCurrent() {
        let tokens = [];
        while (this.currentChar !== null) {
            if (/\s/.test(this.currentChar)) {
                this.skipWhitespace();
            }
            if (this.currentChar === null) {
                return tokens;
            }
            if (DASHES.includes(this.currentChar)) {
                tokens.push(this.dash());
                continue;
            }
            tokens.push(this.text());
        }
        return tokens;
    }
}
exports.Lexer = Lexer;
