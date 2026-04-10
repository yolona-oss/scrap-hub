export interface OrgData {
    name: string
    source: string
    email: string | null
    phone: string | null
    address: string | null
    url?: string
}

export interface SearchQuery {
    query: string
    city?: string
    sources: string[]
    maxResults: number
}
