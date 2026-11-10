import { LOOP_ANIMATION } from '../model'

export function allAnimations(): any[] {
    return (typeof Animator !== 'undefined' && Animator ? Animator.animations : null) ?? []
}

export function findLoopAnimation(): BBAnimation | null {
    return allAnimations().find((animation) => animation && animation.name === LOOP_ANIMATION) ?? null
}

export function animationFrames(animation: any, fps: number): number {
    return Math.max(1, Math.round(Number(animation.length) * fps))
}
