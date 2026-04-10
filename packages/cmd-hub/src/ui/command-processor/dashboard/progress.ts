export type ProgressStatus = 'active' | 'done' | 'failed' | 'skipped'

export interface ProgressEntry {
    name: string
    current: number
    total: number
    status: ProgressStatus
    children: Map<string, ProgressEntry>
}

const BAR_FILL = '='
const BAR_HEAD = '>'
const BAR_EMPTY = '-'

export class ProgressTracker {
    private entries = new Map<string, ProgressEntry>()

    /**
     * Set progress for a named bar.
     * Use dot notation for sub-progress: "scraping.google", "scraping.avito"
     * Parent "scraping" auto-calculates from children recursively.
     */
    set(name: string, current: number, total: number): void {
        const parts = name.split('.')
        if (parts.length === 1) {
            const entry = this.getOrCreate(this.entries, parts[0])
            entry.current = current
            entry.total = total
        } else {
            const parent = this.getOrCreate(this.entries, parts[0])
            this.setNested(parent, parts.slice(1).join('.'), current, total)
        }
    }

    private setNested(parent: ProgressEntry, path: string, current: number, total: number): void {
        const parts = path.split('.')
        if (parts.length === 1) {
            const child = this.getOrCreate(parent.children, parts[0])
            child.current = current
            child.total = total
        } else {
            const next = this.getOrCreate(parent.children, parts[0])
            this.setNested(next, parts.slice(1).join('.'), current, total)
        }
    }

    /**
     * Mark a progress entry as failed/skipped/done.
     * Failed/skipped entries are excluded from parent aggregation.
     */
    setStatus(name: string, status: ProgressStatus): void {
        const parts = name.split('.')
        let map = this.entries
        let entry: ProgressEntry | undefined
        for (const part of parts) {
            entry = map.get(part)
            if (!entry) return
            map = entry.children
        }
        if (entry) entry.status = status
    }

    private getOrCreate(map: Map<string, ProgressEntry>, name: string): ProgressEntry {
        let entry = map.get(name)
        if (!entry) {
            entry = { name, current: 0, total: 0, status: 'active', children: new Map() }
            map.set(name, entry)
        }
        return entry
    }

    remove(name: string): void {
        const parts = name.split('.')
        if (parts.length === 1) {
            this.entries.delete(parts[0])
        } else {
            const parent = this.entries.get(parts[0])
            if (parent) {
                this.removeNested(parent, parts.slice(1).join('.'))
            }
        }
    }

    private removeNested(parent: ProgressEntry, path: string): void {
        const parts = path.split('.')
        if (parts.length === 1) {
            parent.children.delete(parts[0])
        } else {
            const next = parent.children.get(parts[0])
            if (next) this.removeNested(next, parts.slice(1).join('.'))
        }
    }

    clear(): void {
        this.entries.clear()
    }

    get isEmpty(): boolean {
        return this.entries.size === 0
    }

    /**
     * Recursively compute aggregated current/total for an entry.
     * Failed/skipped children are excluded from aggregation.
     */
    private aggregate(entry: ProgressEntry): { current: number, total: number } {
        if (entry.children.size === 0) {
            if (entry.status === 'failed' || entry.status === 'skipped') {
                return { current: 0, total: 0 }
            }
            return { current: entry.current, total: entry.total }
        }

        let totalCurrent = 0
        let totalTotal = 0
        for (const [_, child] of entry.children) {
            if (child.status === 'failed' || child.status === 'skipped') continue
            const agg = this.aggregate(child)
            totalCurrent += agg.current
            totalTotal += agg.total
        }
        return { current: totalCurrent, total: totalTotal }
    }

    render(maxWidth: number): string {
        if (this.entries.size === 0) return ''

        let text = ''
        for (const [_, entry] of this.entries) {
            text += this.renderEntry(entry, maxWidth, 0)
        }
        return text
    }

    private renderEntry(entry: ProgressEntry, maxWidth: number, indent: number): string {
        let text = ''
        const prefix = ' '.repeat(indent)
        const availWidth = maxWidth - indent

        // Failed/skipped: show status text instead of bar
        if (entry.status === 'failed') {
            text += prefix + `${entry.name}: FAILED\n`
            return text
        }
        if (entry.status === 'skipped') {
            text += prefix + `${entry.name}: SKIPPED\n`
            return text
        }

        if (entry.children.size > 0) {
            const { current, total } = this.aggregate(entry)
            text += prefix + this.renderBar(entry.name, current, total, availWidth) + '\n'

            for (const [_, child] of entry.children) {
                text += this.renderEntry(child, maxWidth, indent + 1)
            }
        } else {
            text += prefix + this.renderBar(entry.name, entry.current, entry.total, availWidth) + '\n'
        }

        return text
    }

    private renderBar(name: string, current: number, total: number, maxWidth: number): string {
        const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0
        const percentStr = `${percent}%`
        const countStr = `${current}/${total}`

        const labelPart = `${name}: `
        const percentPart = ` [${percentStr}] ${countStr}`
        const barSpace = maxWidth - labelPart.length - percentPart.length - 2

        if (barSpace < 5) {
            return `${labelPart}${percentStr} ${countStr}`
        }

        const filled = Math.round((percent / 100) * barSpace)
        const empty = barSpace - filled

        const bar = filled > 0
            ? BAR_FILL.repeat(Math.max(0, filled - 1)) + BAR_HEAD + BAR_EMPTY.repeat(empty)
            : BAR_EMPTY.repeat(barSpace)

        return `${labelPart}[${bar}]${percentPart}`
    }
}
