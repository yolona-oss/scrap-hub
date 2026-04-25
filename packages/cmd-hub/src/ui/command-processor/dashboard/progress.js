"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProgressTracker = void 0;
const BAR_FILL = '=';
const BAR_HEAD = '>';
const BAR_EMPTY = '-';
class ProgressTracker {
    entries = new Map();
    set(name, current, total) {
        const parts = name.split('.');
        if (parts.length === 1) {
            const entry = this.getOrCreate(this.entries, parts[0]);
            entry.current = current;
            entry.total = total;
        }
        else {
            const parent = this.getOrCreate(this.entries, parts[0]);
            this.setNested(parent, parts.slice(1).join('.'), current, total);
        }
    }
    setNested(parent, path, current, total) {
        const parts = path.split('.');
        if (parts.length === 1) {
            const child = this.getOrCreate(parent.children, parts[0]);
            child.current = current;
            child.total = total;
        }
        else {
            const next = this.getOrCreate(parent.children, parts[0]);
            this.setNested(next, parts.slice(1).join('.'), current, total);
        }
    }
    setStatus(name, status) {
        const parts = name.split('.');
        let map = this.entries;
        let entry;
        for (const part of parts) {
            entry = map.get(part);
            if (!entry)
                return;
            map = entry.children;
        }
        if (entry)
            entry.status = status;
    }
    getOrCreate(map, name) {
        let entry = map.get(name);
        if (!entry) {
            entry = { name, current: 0, total: 0, status: 'active', children: new Map() };
            map.set(name, entry);
        }
        return entry;
    }
    remove(name) {
        const parts = name.split('.');
        if (parts.length === 1) {
            this.entries.delete(parts[0]);
        }
        else {
            const parent = this.entries.get(parts[0]);
            if (parent) {
                this.removeNested(parent, parts.slice(1).join('.'));
            }
        }
    }
    removeNested(parent, path) {
        const parts = path.split('.');
        if (parts.length === 1) {
            parent.children.delete(parts[0]);
        }
        else {
            const next = parent.children.get(parts[0]);
            if (next)
                this.removeNested(next, parts.slice(1).join('.'));
        }
    }
    clear() {
        this.entries.clear();
    }
    get isEmpty() {
        return this.entries.size === 0;
    }
    aggregate(entry) {
        if (entry.children.size === 0) {
            if (entry.status === 'failed' || entry.status === 'skipped') {
                return { current: 0, total: 0 };
            }
            return { current: entry.current, total: entry.total };
        }
        let totalCurrent = 0;
        let totalTotal = 0;
        for (const [_, child] of entry.children) {
            if (child.status === 'failed' || child.status === 'skipped')
                continue;
            const agg = this.aggregate(child);
            totalCurrent += agg.current;
            totalTotal += agg.total;
        }
        return { current: totalCurrent, total: totalTotal };
    }
    render(maxWidth) {
        if (this.entries.size === 0)
            return '';
        let text = '';
        for (const [_, entry] of this.entries) {
            text += this.renderEntry(entry, maxWidth, 0);
        }
        return text;
    }
    renderEntry(entry, maxWidth, indent) {
        let text = '';
        const prefix = ' '.repeat(indent);
        const availWidth = maxWidth - indent;
        if (entry.status === 'failed') {
            text += prefix + `${entry.name}: FAILED\n`;
            return text;
        }
        if (entry.status === 'skipped') {
            text += prefix + `${entry.name}: SKIPPED\n`;
            return text;
        }
        if (entry.children.size > 0) {
            const { current, total } = this.aggregate(entry);
            text += prefix + this.renderBar(entry.name, current, total, availWidth) + '\n';
            for (const [_, child] of entry.children) {
                text += this.renderEntry(child, maxWidth, indent + 1);
            }
        }
        else {
            text += prefix + this.renderBar(entry.name, entry.current, entry.total, availWidth) + '\n';
        }
        return text;
    }
    renderBar(name, current, total, maxWidth) {
        const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
        const percentStr = `${percent}%`;
        const countStr = `${current}/${total}`;
        const labelPart = `${name}: `;
        const percentPart = ` [${percentStr}] ${countStr}`;
        const barSpace = maxWidth - labelPart.length - percentPart.length - 2;
        if (barSpace < 5) {
            return `${labelPart}${percentStr} ${countStr}`;
        }
        const filled = Math.round((percent / 100) * barSpace);
        const empty = barSpace - filled;
        const bar = filled > 0
            ? BAR_FILL.repeat(Math.max(0, filled - 1)) + BAR_HEAD + BAR_EMPTY.repeat(empty)
            : BAR_EMPTY.repeat(barSpace);
        return `${labelPart}[${bar}]${percentPart}`;
    }
}
exports.ProgressTracker = ProgressTracker;
