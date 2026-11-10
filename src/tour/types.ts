export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center'

export interface TourStep {
    id: string
    title: string
    body: string
    target?: () => Element | null | undefined
    placement?: TourPlacement
    mode?: 'design' | 'animate' | 'none'
    before?: () => void | Promise<void>
    task?: string
    done?: () => boolean
    doneText?: string
}

export interface TourChapter {
    id: string
    title: string
    steps: TourStep[]
}
