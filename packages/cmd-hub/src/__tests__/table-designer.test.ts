import { TableDesigner, escapeHtml } from "@cmd-hub/common"
import type { TableField, TextField } from "@cmd-hub/common"

describe('TableDesigner', () => {
    let designer: TableDesigner

    beforeEach(() => {
        designer = new TableDesigner()
    })

    describe('constructTable', () => {
        it('renders correct structure: header, separator, and data rows', () => {
            // col0: max(4,3,3)+2=6, col1: max(3,2,2)+2=5. Total=11 ≤ 40 → fits
            const field: TableField = {
                title: '',
                header: ['Name', 'Age'],
                body: [['foo', '25'], ['baz', '30']],
            }
            const result = designer.constructTable(field, 40)
            const lines = result.split('\n')

            expect(lines[0]).toBe(' Name  Age ')
            expect(lines[1]).toBe('-----------')
            expect(lines[2]).toBe(' foo   25  ')
            expect(lines[3]).toBe(' baz   30  ')
        })

        it('pads all rows to the same total width', () => {
            // col0: max(1,5)+2=7, col1: max(1,12)+2=14. Total=21 ≤ 80 → fits
            const field: TableField = {
                title: '',
                header: ['K', 'V'],
                body: [['short', 'longvalue123']],
            }
            const result = designer.constructTable(field, 80)
            const lines = result.split('\n').filter(l => l.length > 0)

            expect(lines[0]).toBe(' K      V            ')
            expect(lines[1]).toBe('---------------------')
            expect(lines[2]).toBe(' short  longvalue123 ')
            expect(lines.every(l => l.length === 21)).toBe(true)
        })

        it('caps wide columns and wraps long values into multiple lines', () => {
            // Natural: col0=max(3,3)+2=5, col1=max(5,26)+2=28. Total=33 > 25
            // fitColumns shrinks col1 from 28 to 20 (25-5=20)
            // cellWidth for col1 = 18. "abcdefghijklmnopqrstuvwxyz" (26 chars) wraps.
            const field: TableField = {
                title: '',
                header: ['Key', 'Value'],
                body: [['abc', 'abcdefghijklmnopqrstuvwxyz']],
            }
            const result = designer.constructTable(field, 25)
            const lines = result.split('\n').filter(l => l.length > 0)

            // Should have header + sep + at least 2 data lines (value wraps)
            expect(lines.length).toBeGreaterThan(3)

            // First data line has key, continuation lines have blank key column
            expect(lines[2]).toContain('abc')

            // All 26 chars of the value should be present
            const allText = lines.slice(2).map(l => l.trim()).join('')
            expect(allText.replace(/\s+/g, '')).toContain('abcdefghijklmnopqrstuvwxyz')

            // All lines should be same width (aligned)
            const widths = new Set(lines.map(l => l.length))
            expect(widths.size).toBe(1)
        })

        it('continuation lines have blank key column during value wrap', () => {
            // Force a narrow table where value wraps
            const field: TableField = {
                title: '',
                header: ['K', 'V'],
                body: [['x', '1234567890abcdef']],
            }
            const result = designer.constructTable(field, 15)
            const lines = result.split('\n').filter(l => l.length > 0)
            const dataLines = lines.slice(2) // skip header + sep

            expect(dataLines.length).toBeGreaterThan(1)
            // First data line has the key
            expect(dataLines[0]).toContain('x')
            // Continuation lines: key column area should be blank
            for (let i = 1; i < dataLines.length; i++) {
                // Key column is the leftmost part before the value starts
                // col0 width = max(1,1)+2=3. Key area = first 3 chars
                const keyArea = dataLines[i].slice(0, 3)
                expect(keyArea.trim()).toBe('')
            }
        })

        it('handles empty body — only header and separator', () => {
            const field: TableField = {
                title: '',
                header: ['A', 'B'],
                body: [],
            }
            const result = designer.constructTable(field, 40)
            const lines = result.split('\n').filter(l => l.length > 0)

            expect(lines.length).toBe(2)
            expect(lines[0]).toBe(' A  B ')
            expect(lines[1]).toBe('------')
        })

        it('handles empty cell content with blank padding', () => {
            // col0: max(3,4)+2=6, col1: max(5,0)+2=7. Total=13 ≤ 40
            const field: TableField = {
                title: '',
                header: ['Key', 'Value'],
                body: [['name', '']],
            }
            const result = designer.constructTable(field, 40)
            const lines = result.split('\n').filter(l => l.length > 0)

            expect(lines[0]).toBe(' Key   Value ')
            expect(lines[1]).toBe('-------------')
            expect(lines[2]).toBe(' name        ')
        })

        it('handles multiple rows correctly', () => {
            const field: TableField = {
                title: '',
                header: ['Id', 'Name', 'Score'],
                body: [
                    ['1', 'Alice', '95'],
                    ['2', 'Bob', '87'],
                    ['3', 'Charlie', '92'],
                ],
            }
            // col0=4, col1=9, col2=7. Total=20 ≤ 40
            const result = designer.constructTable(field, 40)
            const lines = result.split('\n').filter(l => l.length > 0)

            expect(lines.length).toBe(5)
            expect(lines[0]).toBe(' Id  Name     Score ')
            expect(lines[1]).toBe('--------------------')
            expect(lines[2]).toBe(' 1   Alice    95    ')
            expect(lines[3]).toBe(' 2   Bob      87    ')
            expect(lines[4]).toBe(' 3   Charlie  92    ')
        })

        it('handles row with missing columns by treating as empty', () => {
            // col0=8, col1=3. Total=11 ≤ 40
            const field: TableField = {
                title: '',
                header: ['A', 'B'],
                body: [['only_a']],
            }
            const result = designer.constructTable(field, 40)
            const lines = result.split('\n').filter(l => l.length > 0)

            expect(lines[0]).toBe(' A       B ')
            expect(lines[1]).toBe('-----------')
            expect(lines[2]).toBe(' only_a    ')
        })

        it('shrinks the widest column first when total exceeds maxWidth', () => {
            // col0: max(1,2)+2=4 (narrow)
            // col1: max(1,40)+2=42 (very wide)
            // Total=46 > 20. fitColumns shrinks col1 from 42 to 16 (20-4=16).
            // cellWidth=14. Value wraps: 40/14 = 3 lines.
            const field: TableField = {
                title: '',
                header: ['K', 'V'],
                body: [['ab', 'x'.repeat(40)]],
            }
            const result = designer.constructTable(field, 20)
            const lines = result.split('\n').filter(l => l.length > 0)

            // All lines exactly 20 chars
            expect(lines.every(l => l.length === 20)).toBe(true)
            // Full value present
            const allContent = lines.slice(2).join('')
            expect(allContent.replace(/\s/g, '')).toContain('x'.repeat(40))
        })

        it('does not shrink columns below minimum width', () => {
            // Even with extreme maxWidth pressure, columns don't go below MIN_COL=6
            const field: TableField = {
                title: '',
                header: ['Key', 'Val'],
                body: [['test', 'data']],
            }
            // col0=6, col1=6. Total=12 > 8. Try to shrink but MIN_COL=6 stops it.
            const result = designer.constructTable(field, 8)
            const lines = result.split('\n').filter(l => l.length > 0)

            // Columns stay at minimum 6 each = 12 (exceeds maxWidth but can't shrink further)
            expect(lines[0].length).toBeGreaterThanOrEqual(12)
        })

        it('returns empty string for empty headers', () => {
            const field: TableField = {
                title: '',
                header: [],
                body: [],
            }
            expect(designer.constructTable(field, 40)).toBe('')
        })
    })

    describe('constructText', () => {
        it('wraps text at exact maxWidth boundaries', () => {
            const field: TextField = { title: '', text: 'abcdefghijklmnopqrstuvwxyz' }
            const result = designer.constructText(field, 10)
            const lines = result.split('\n').filter(l => l.length > 0)

            expect(lines.length).toBe(3)
            expect(lines[0]).toBe('abcdefghij')
            expect(lines[1]).toBe('klmnopqrst')
            expect(lines[2]).toBe('uvwxyz')
        })

        it('does not wrap text shorter than maxWidth', () => {
            const field: TextField = { title: '', text: 'short' }
            const result = designer.constructText(field, 80)
            const lines = result.split('\n').filter(l => l.length > 0)

            expect(lines.length).toBe(1)
            expect(lines[0]).toBe('short')
        })

        it('returns empty string for empty text', () => {
            expect(designer.constructText({ title: '', text: '' }, 80)).toBe('')
        })
    })

    describe('make', () => {
        it('prepends title line before table content', () => {
            const result = designer.make({
                title: 'My Table',
                header: ['A'],
                body: [['val']],
            }, 40)
            const lines = result.split('\n')

            expect(lines[0]).toBe('My Table')
            expect(lines[1]).toContain('A')
        })

        it('omits title when empty — first line is table header', () => {
            const result = designer.make({
                title: '',
                header: ['Col'],
                body: [['val']],
            }, 40)

            expect(result.split('\n')[0]).toBe(' Col ')
        })

        it('shortens title to maxWidth', () => {
            const result = designer.make({
                title: 'A'.repeat(100),
                header: ['X'],
                body: [],
            }, 10)

            expect(result.split('\n')[0].length).toBeLessThanOrEqual(10)
        })
    })

    describe('escapeHtml', () => {
        it('escapes <, >, and &', () => {
            expect(escapeHtml('<b>test</b>')).toBe('&lt;b&gt;test&lt;/b&gt;')
            expect(escapeHtml('a & b')).toBe('a &amp; b')
            expect(escapeHtml('x < y > z')).toBe('x &lt; y &gt; z')
        })

        it('leaves normal text unchanged', () => {
            expect(escapeHtml('hello world')).toBe('hello world')
        })

        it('handles empty string', () => {
            expect(escapeHtml('')).toBe('')
        })
    })

    describe('HTML escaping in tables', () => {
        it('escapes HTML in cell content', () => {
            const result = designer.constructTable({
                title: '',
                header: ['Key', 'Value'],
                body: [['tag', '<script>alert(1)</script>']],
            }, 80)

            expect(result).toContain('&lt;script&gt;')
            expect(result).not.toContain('<script>')
        })

        it('escapes HTML in header', () => {
            const result = designer.constructTable({
                title: '',
                header: ['A<B', 'C&D'],
                body: [['x', 'y']],
            }, 80)

            expect(result).toContain('A&lt;B')
            expect(result).toContain('C&amp;D')
        })

        it('escapes HTML in title via make()', () => {
            const result = designer.make({
                title: 'Config <system>',
                header: ['K'],
                body: [],
            }, 80)

            expect(result).toContain('Config &lt;system&gt;')
        })

        it('escapes HTML in text content', () => {
            const result = designer.constructText({
                title: '',
                text: 'a < b & c > d',
            }, 80)

            expect(result).toContain('a &lt; b &amp; c &gt; d')
        })
    })
})
