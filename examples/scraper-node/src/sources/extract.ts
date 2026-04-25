export function extractEmail(text: string): string | null {
    const match = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/i)
    return match ? match[0] : null
}

export function extractPhone(text: string): string | null {
    const match = text.match(/(?:\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/)
    return match ? match[0].replace(/[\s\-()]/g, '').replace(/^8/, '+7') : null
}

export function extractAddress(text: string): string | null {
    const match = text.match(/(?:г\.|ул\.|пр\.|пер\.|д\.|стр\.)[\wа-яА-ЯёЁ\s,.\-\/]+/i)
    return match ? match[0].trim() : null
}
