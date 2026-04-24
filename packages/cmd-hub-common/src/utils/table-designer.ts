function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj
    if (typeof obj === 'function') {
        // @ts-ignore
        return obj.bind({})
    }
    if (Array.isArray(obj)) {
        const arrCopy: any[] = []
        for (const item of obj) arrCopy.push(deepClone(item))
        return arrCopy as unknown as T
    }
    const objCopy: { [key: string]: any } = {}
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            objCopy[key] = deepClone((obj as any)[key])
        }
    }
    return objCopy as T
}

function shorten(input: string, charsToKeep: number): string {
    if (input.length <= charsToKeep) return input
    if (charsToKeep <= 3) {
        if (charsToKeep === 3) {
            return `${input[0]}..${input[input.length - 1]}`.slice(0, 3)
        }
        return input.slice(0, charsToKeep)
    }
    const charsFromEachSide = Math.floor((charsToKeep - 2) / 2)
    const start = input.slice(0, charsFromEachSide)
    const remainingChars = charsToKeep - (charsFromEachSide * 2 + 2)
    const adjustedEnd = input.slice(-(charsFromEachSide + remainingChars))
    return `${start}..${adjustedEnd}`
}

export interface TableField {
    title: string
    header: string[]
    body: string[][]
}

export interface TextField {
    title: string
    text: string
}

export type MarkupField = TableField | TextField

function isTableField(field: MarkupField): field is TableField {
    return 'header' in field
}

export function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export class TableDesigner {
    constructTable(field: TableField, maxWidth: number): string {
        const table = deepClone(field)
        let str = ''

        const numCols = table.header.length
        if (numCols === 0) return str

        for (let i = 0; i < numCols; i++) {
            table.header[i] = escapeHtml(table.header[i])
        }
        for (const row of table.body) {
            for (let i = 0; i < row.length; i++) {
                row[i] = escapeHtml(row[i] || '')
            }
        }

        const naturalWidths = table.header.map((_, colIndex) => {
            const headerWidth = table.header[colIndex].length
            const maxCellWidth = table.body.reduce((max, row) => {
                const cellWidth = (row[colIndex] || '').length
                return Math.max(max, cellWidth)
            }, 0)
            return Math.max(headerWidth, maxCellWidth) + 2
        })

        const columnWidths = this.fitColumns(naturalWidths, maxWidth)

        const headerCells = columnWidths.map((w, colIndex) => {
            const content = table.header[colIndex] || ''
            const inner = w - 2
            const text = content.length > inner ? content.slice(0, inner) : content.padEnd(inner, ' ')
            return ` ${text} `
        })
        str += headerCells.join('') + '\n'

        str += columnWidths.map(w => '-'.repeat(w)).join('') + '\n'

        for (const row of table.body) {
            const rowCells: string[][] = []
            let maxCellLines = 1

            for (let colIndex = 0; colIndex < numCols; colIndex++) {
                const cellContent = row[colIndex] || ''
                const cellWidth = columnWidths[colIndex] - 2
                const cellLines: string[] = []

                if (cellContent.length === 0) {
                    cellLines.push(' '.repeat(cellWidth))
                } else if (cellContent.length <= cellWidth) {
                    cellLines.push(cellContent.padEnd(cellWidth, ' '))
                } else {
                    for (let i = 0; i < cellContent.length; i += cellWidth) {
                        const line = cellContent.slice(i, i + cellWidth)
                        cellLines.push(line.padEnd(cellWidth, ' '))
                    }
                }

                rowCells.push(cellLines)
                maxCellLines = Math.max(maxCellLines, cellLines.length)
            }

            for (let lineIndex = 0; lineIndex < maxCellLines; lineIndex++) {
                const lineParts = columnWidths.map((w, colIndex) => {
                    const cellLines = rowCells[colIndex]
                    const line = lineIndex < cellLines.length
                        ? cellLines[lineIndex]
                        : ' '.repeat(w - 2)
                    return ` ${line} `
                })
                str += lineParts.join('') + '\n'
            }
        }

        str += '\n'
        return str
    }

    private fitColumns(naturalWidths: number[], maxWidth: number): number[] {
        const total = naturalWidths.reduce((a, b) => a + b, 0)
        if (total <= maxWidth) return naturalWidths

        const MIN_COL = 6
        const result = [...naturalWidths]

        let remaining = total
        while (remaining > maxWidth) {
            const maxCol = result.reduce((max, w, i) => w > result[max] ? i : max, 0)
            if (result[maxCol] <= MIN_COL) break

            const excess = remaining - maxWidth
            const shrink = Math.min(excess, result[maxCol] - MIN_COL)
            result[maxCol] -= shrink
            remaining -= shrink
        }

        return result
    }

    constructText(field: TextField, maxWidth: number): string {
        const text = escapeHtml(field.text)
        let str = ''
        for (let i = 0; i < text.length; i += maxWidth) {
            str += text.slice(i, i + maxWidth) + '\n'
        }
        return str
    }

    make(field: MarkupField, maxWidth: number): string {
        const title = field.title.length > 0 ? `${escapeHtml(shorten(field.title, maxWidth))}\n` : ''
        if (isTableField(field)) {
            return title + this.constructTable(field, maxWidth)
        } else {
            return title + this.constructText(field, maxWidth)
        }
    }
}
