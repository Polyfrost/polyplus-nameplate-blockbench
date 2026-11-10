import { FORMAT_ID } from '../model'

function openProjects(): any[] {
    const all = typeof ModelProject === 'undefined' ? null : (ModelProject as any).all
    return Array.isArray(all) ? all.slice() : []
}

function currentType(typeId: unknown): any | null {
    if (typeof typeId !== 'string' || typeof OutlinerElement === 'undefined') return null
    return (OutlinerElement.types as any)[typeId] ?? null
}

function adoptElements(project: any, adopted: Set<string>) {
    const elements: any[] = Array.isArray(project?.elements) ? project.elements : []
    for (const element of elements) {
        const type = currentType(element?.type)
        if (!type || element instanceof type) continue
        Object.setPrototypeOf(element, type.prototype)
        adopted.add(element.type)
    }
}

function adoptAnimators(project: any, adopted: Set<string>) {
    const animations: any[] = Array.isArray(project?.animations) ? project.animations : []
    for (const animation of animations) {
        for (const animator of Object.values<any>(animation?.animators ?? {})) {
            if (!animator || !adopted.has(animator.type)) continue
            const target = currentType(animator.type)?.animator
            if (typeof target !== 'function' || animator instanceof target) continue
            Object.setPrototypeOf(animator, target.prototype)
        }
    }
}

export function adoptOpenProjects() {
    const format = typeof Formats === 'undefined' ? undefined : Formats[FORMAT_ID]
    if (!format) return
    let reselect = false
    for (const project of openProjects()) {
        if (project?.format?.id !== FORMAT_ID) continue
        try {
            const adopted = new Set<string>()
            adoptElements(project, adopted)
            adoptAnimators(project, adopted)
            if (project.format !== format) {
                project.format = format
                if (typeof Project !== 'undefined' && Project === project) reselect = true
            }
        } catch (error) {
            console.error('[polyplus_nameplate] could not reconnect an open nameplate', error)
        }
    }
    if (!reselect) return
    try {
        format.select()
        if (typeof updateSelection === 'function') updateSelection()
    } catch (error) {
        console.error('[polyplus_nameplate] could not refresh the open nameplate', error)
    }
}
