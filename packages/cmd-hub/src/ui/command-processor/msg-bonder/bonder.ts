import { BaseUIContext, IUI } from "../../../ui/types";
import { IMarkupButton } from "../../../ui/command-processor/types/markup";

import { TableDesigner, MarkupField } from "@cmd-hub/common";

export interface IMessageBonderMarkup {
    title: string
    fields: MarkupField[]
    buttons: Array<IMarkupButton>
}

class MarkupHolder {
    private mkup: IMessageBonderMarkup
    private designer: TableDesigner
    private maxWidth: number

    constructor(maxWidth: number) {
        this.maxWidth = maxWidth
        this.designer = new TableDesigner()

        this.mkup = {
            title: '',
            fields: [],
            buttons: []
        }
    }

    update(mkup: Partial<IMessageBonderMarkup>) {
        Object.assign(this.mkup, mkup)
    }

    get asMessage(): string {
        let message = `${this.mkup.title}\n`
        for (const field of this.mkup.fields) {
            message += this.designer.make(field, this.maxWidth) + '\n'
        }
        return message
    }
}

/***
 * @param maxWidth - maximum width of message in characters. By default use max_message_width from UI object
 */
export class MessageBonder<CtxType extends BaseUIContext = BaseUIContext> {
    private attached_message_id!: string

    private uiImpl: IUI<CtxType>
    private user_id: string

    private mkHolder: MarkupHolder

    constructor(
        uiImpl: IUI<CtxType>,
        user_id: string,
        maxWidth?: number
    ) {
        this.uiImpl = uiImpl
        this.user_id = user_id

        this.mkHolder = new MarkupHolder(maxWidth ?? uiImpl.max_message_width())
    }

    async attach(pending_text: string = 'Initializing message bonder...') {
        this.attached_message_id = await this.uiImpl.sendMessage(this.user_id, pending_text)
    }

    async update(query: Partial<IMessageBonderMarkup>) {
        this.mkHolder.update(query)
        return await this.uiImpl.editMessage(
            this.user_id,
            this.attached_message_id,
            this.mkHolder.asMessage,
        )
    }

    async detach() {
        return await this.uiImpl.deleteMessage(this.user_id, this.attached_message_id)
    }
}
