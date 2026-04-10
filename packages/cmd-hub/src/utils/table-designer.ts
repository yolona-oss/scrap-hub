import { deepClone } from "@core/utils/object"
import { shorten } from "@core/utils/string"

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

        // Escape HTML in all cell content
        for (let i = 0; i < numCols; i++) {
            table.header[i] = escapeHtml(table.header[i])
        }
        for (const row of table.body) {
            for (let i = 0; i < row.length; i++) {
                row[i] = escapeHtml(row[i] || '')
            }
        }

        // Calculate natural column widths (including padding)
        const naturalWidths = table.header.map((_, colIndex) => {
            const headerWidth = table.header[colIndex].length
            const maxCellWidth = table.body.reduce((max, row) => {
                const cellWidth = (row[colIndex] || '').length
                return Math.max(max, cellWidth)
            }, 0)
            return Math.max(headerWidth, maxCellWidth) + 2 // +2 for padding (1 space each side)
        })

        // Cap column widths to fit within maxWidth
        const columnWidths = this.fitColumns(naturalWidths, maxWidth)

        // Build table — all columns in one group since they now fit
        // Header
        const headerCells = columnWidths.map((w, colIndex) => {
            const content = table.header[colIndex] || ''
            const inner = w - 2
            const text = content.length > inner ? content.slice(0, inner) : content.padEnd(inner, ' ')
            return ` ${text} `
        })
        str += headerCells.join('') + '\n'

        // Separator
        str += columnWidths.map(w => '-'.repeat(w)).join('') + '\n'

        // Body rows
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
                    // Wrap long content across multiple lines
                    for (let i = 0; i < cellContent.length; i += cellWidth) {
                        const line = cellContent.slice(i, i + cellWidth)
                        cellLines.push(line.padEnd(cellWidth, ' '))
                    }
                }

                rowCells.push(cellLines)
                maxCellLines = Math.max(maxCellLines, cellLines.length)
            }

            // Build each line of the row
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

    /**
     * Fit columns into maxWidth by capping oversized columns proportionally.
     * Columns that fit naturally keep their width; excess is taken from wide columns.
     */
    private fitColumns(naturalWidths: number[], maxWidth: number): number[] {
        const total = naturalWidths.reduce((a, b) => a + b, 0)
        if (total <= maxWidth) return naturalWidths

        const MIN_COL = 6 // minimum column width (4 content + 2 padding)
        const result = [...naturalWidths]

        // Iteratively shrink the widest columns until total fits
        let remaining = total
        while (remaining > maxWidth) {
            const maxCol = result.reduce((max, w, i) => w > result[max] ? i : max, 0)
            if (result[maxCol] <= MIN_COL) break // can't shrink further

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
