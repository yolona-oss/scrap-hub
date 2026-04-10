export function inCenter(text: string, fill = " ") {
    const cols = process.stdout.columns || 80
    const text_len = text.length

    const side_len = Math.max(0, Math.floor((cols - text_len) / 2))
    const filler_fn = (n: number) => new Array(n).fill(fill).join("")
    const filler = filler_fn(side_len)

    const rest = Math.max(0, cols - (side_len * 2 + text_len))

    return filler + text + filler + filler_fn(rest)
}

export function clearScreen() {
    let lines = process.stdout.getWindowSize()[1]
    for(let i = 0; i < lines; i++) {
        console.log('\r\n')
    }
}
