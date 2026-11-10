interface MessageSpec {
    title: string
    icon?: string
    message: string
    buttons?: string[]
    cancel?: number
    width?: number
}

export function dialogButtons(...labels: string[]) {
    return { buttons: labels, confirmIndex: 0, cancelIndex: labels.length - 1 }
}

export const CREATE_AND_PAINT_BUTTONS = dialogButtons('Create', 'Create and paint', 'Cancel')

export function messageBox(spec: MessageSpec, onButton?: (button: number | string) => void) {
    const { buttons, cancel, ...rest } = spec
    const options = buttons ? { ...rest, buttons, confirmIndex: 0, cancelIndex: cancel ?? buttons.length - 1 } : rest
    Blockbench.showMessageBox(options as any, onButton as any)
}

export function confirmBox(spec: { title: string, icon: string, message: string, confirm: string, width?: number }, onConfirm: () => void) {
    const { confirm, ...rest } = spec
    messageBox({ ...rest, buttons: [confirm, 'Cancel'] }, (button) => {
        if (button === 0) onConfirm()
    })
}
