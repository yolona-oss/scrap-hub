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

