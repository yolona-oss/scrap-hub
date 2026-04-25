/** Walk the current Error stack trace and pull out the caller frame. Used
 *  by the logger to annotate messages with the originating file/function/line.
 *  Returns "unknown" sentinels when the stack format isn't recognized. */
export function getInvokerDetails(): { fileName: string; functionName: string; lineNumber: string } {
    const error = new Error()
    const stack = error.stack?.split('\n') || []

    const callerLine = stack[4] || ''

    const match = callerLine.match(/at (.+) \((.+):(\d+):\d+\)/) || callerLine.match(/at (.+):(\d+):(\d+)/)

    if (match) {
        return {
            fileName: match[2] || 'unknown',
            functionName: match[1] || 'anonymous',
            lineNumber: match[3] || 'unknown',
        }
    }

    return {
        fileName: 'unknown',
        functionName: 'unknown',
        lineNumber: 'unknown',
    }
}
