export function anyToString(error: any): string {
    if (error instanceof Error) {
        return error.message
    } else if (typeof error === 'string' || typeof error === 'number') {
        return String(error)
    } else if (typeof error === 'object') {
        return JSON.stringify(error, null, 4)
    } else {
        return String(error)
    }
}

export function camelCase(input: string) { 
    return input.toLowerCase().replace(/-(.)/g, function(_, group1) {
        return group1.toUpperCase()
    })
}

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

