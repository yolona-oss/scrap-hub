export async function elapsedExec(fn: () => Promise<any>): Promise<{ elapsed: number, result: any}> {
    const start = performance.now()
    let res = null
    try {
        res = await fn();
    } catch (e) {
        console.error(e)
        throw e
    }
    return {
        elapsed: performance.now() - start,
        result: res
    }
}
