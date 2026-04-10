import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

export class HttpClient {
    private client: AxiosInstance

    constructor(baseURL: string, config?: AxiosRequestConfig) {
        this.client = axios.create({
            baseURL,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            ...config,
        })
    }

    public async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        const response: AxiosResponse<T> = await this.client.get<T>(url, config)
        return response.data
    }

    public async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
        const response: AxiosResponse<T> = await this.client.post<T>(url, data, config)
        return response.data
    }

    public async put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
        const response: AxiosResponse<T> = await this.client.put<T>(url, data, config)
        return response.data
    }

    public async patch<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
        const response: AxiosResponse<T> = await this.client.patch<T>(url, data, config)
        return response.data
    }

    public async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        const response: AxiosResponse<T> = await this.client.delete<T>(url, config)
        return response.data
    }
}
