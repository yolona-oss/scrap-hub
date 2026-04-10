export type IMarkupInfoType = "name" | "value" | "aux"

export interface IMarkupButton {
    text: string,
    type: IMarkupInfoType,
    isRead?: boolean
    data: string
}

export type IMarkupOption = IMarkupButton

/**
 * @param text - text to describe current action
 * @param buttons - list of options to choose from
 */
export interface IBaseMarkup {
    text: string
    buttons?: IMarkupButton[]
}
