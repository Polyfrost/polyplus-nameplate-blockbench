import { keyTimingProblems, snapKeysToFrames } from '../animate/keys'
import { channelName } from '../animate/checks'
import { reactionProblem } from '../animate/words'
import { badgeNode } from '../badge/node'
import { currentBundle } from '../compile'
import { addVariantFor, colorwayProblems } from '../design/colors'
import { openVariantDialog } from '../design/nameplate'
import { readGroups, readLayers } from '../elements'
import { findNode, isGroupNode, isLayerNode, nameTextNode, walkNodes } from '../elements/nodes'
import { projectFlagProblems } from '../flags/checks'
import { explainIssues, GuideTarget } from '../guide'
import { BundleIssue, LOOP_ANIMATION } from '../model'
import { projectMotionProblems } from '../motion/checks'
import { materialProblem } from '../material/words'
import { molangProblems } from '../molang/problems'
import { textProblemSource } from '../text'
import { paletteAnimationProblems, paletteIssueText } from '../palanim/checks'
import { goMode, paintTexture, showLayer } from '../navigate'
import { pictureStem, sanitizeId } from '../palette/ids'
import { groupWidthIssues } from '../library/problems'
import { cornerProblems } from '../corners/problems'
import { bodyShapeProblems } from '../nodes/checks'
import { keptProblems } from '../import/kept'
import { editVariantButton, layerTarget, nodeTarget, pathCovers, problemFromNode, SELECT_LAYER, selectLayerButton } from '../checks/helpers'
import { budgetText, classifyIssue, curveTextProblems, IssueCode, reviewProblems, strayElementProblems, swappedBodyProblems, unusedPictureProblems } from '../checks'
import {
    ANIMATION_FIELDS,
    BADGE_FIELDS,
    COLOR_FIELDS,
    FLAG_FIELDS,
    GROUP_FIELDS,
    holdText,
    LAYER_FIELDS,
    plainSetting,
    SETTINGS_FIELDS,
    SPRITE_FIELDS,
    TEXT_FIELDS,
    VARIANT_FIELDS,
} from '../checks/words'
import { jumpToPixel } from '../palette/highlight'
import { allAnimations } from '../util/animation'
import { looseLayerId, looseSpriteId } from '../util/bundlePath'
import { hasProject } from '../util/project'
import { isPaintDragging } from '../util/paintDrag'
import { findTexture } from '../util/texture'

export type { IssueCode } from '../checks'
export { classifyIssue, issueCode } from '../checks'

export type ProblemLevel = 'error' | 'warning'

export interface ProblemPixel {
    frame: number
    x: number
    y: number
}

export interface ProblemTarget {
    kind: 'layer' | 'texture' | 'animation' | 'pixel'
    uuid: string
    pixel?: ProblemPixel
}

export interface ProblemButton {
    name: string
    icon: string
    click(): void
}

export interface Problem {
    level: ProblemLevel
    code?: IssueCode
    text: string
    target: ProblemTarget | null
    buttons?: ProblemButton[]
    covers?: (path: string) => boolean
    designerOnly?: boolean
}

export interface ProjectProblems {
    errors: Problem[]
    warnings: Problem[]
}

export type ProblemSource = () => Problem[]

const PICTURE_GONE = /^texture '.*' has no sprite data$/
const PICTURE_SIZE = /px each way$/
const RESIZE_ADVICE = ' To shrink it, use Picture options (three dots) > Resize Texture, with mode Scale.'

function findAnimation(reference: string): any | null {
    return allAnimations().find((animation) => animation?.uuid === reference) ?? allAnimations().find((animation) => animation?.name === reference) ?? null
}

function animationTarget(reference: string): ProblemTarget | null {
    const animation = findAnimation(reference)
    return animation ? { kind: 'animation', uuid: String(animation.uuid) } : null
}

function underFile(file: string): (path: string) => boolean {
    return pathCovers(file, '#')
}

function motionProblems(): Problem[] {
    const ids = new Map(readLayers().map((layer) => [layer.uuid, layer.id]))
    return projectMotionProblems().map((problem) => {
        const id = ids.get(problem.node?.uuid)
        return problemFromNode(problem, id ? underFile(`layers/${id}.json`) : undefined)
    })
}

function flagProblems(): Problem[] {
    return projectFlagProblems().map((problem) =>
        problemFromNode(problem, (path: string) => underFile('flags.json')(path) || /^manifest\.json#variants\.[^.]+\.flag/.test(path)),
    )
}

function colorwayWarnings(): Problem[] {
    return colorwayProblems().map((problem) => ({
        level: 'warning',
        text: problem.message,
        target: null,
        buttons: [{ name: 'Add variant', icon: 'add', click: () => addVariantFor(problem.colorway) }],
    }))
}

function hiddenLayerProblems(): Problem[] {
    const problems: Problem[] = []
    const hidden = new Set<string>()
    walkNodes((node, parent) => {
        const group = isGroupNode(node)
        if (!group && !isLayerNode(node)) return
        if (parent && hidden.has(parent.uuid)) {
            hidden.add(node.uuid)
            return
        }
        if (node.visibility !== false) return
        hidden.add(node.uuid)
        const name = String(node.name ?? '')
        problems.push({
            level: 'warning',
            text: group
                ? `Group '${name}' is hidden in Layers (eye icon), but it still shows in game. Show it, or delete the layers you don't want.`
                : `Layer '${name}' is hidden in Layers (eye icon), but it still shows in game. Show it, or delete it.`,
            target: nodeTarget(node),
        })
    })
    return problems
}

function keyTimingWarnings(): Problem[] {
    return keyTimingProblems().map((problem) => ({
        level: 'warning',
        text: problem.message,
        target: { kind: 'animation', uuid: String(problem.animation.uuid) },
        buttons: [{ name: 'Snap keyframes to frames', icon: 'straighten', click: () => snapKeysToFrames() }],
    }))
}

const SOURCES: Array<[IssueCode, ProblemSource]> = [
    ['element_3d', strayElementProblems],
    ['text', textProblemSource],
    ['motion', motionProblems],
    ['flags', flagProblems],
    ['colorway', colorwayWarnings],
    ['hidden_layer', hiddenLayerProblems],
    ['key_timing', keyTimingWarnings],
    ['kept_track_overridden', keptProblems],
    ['palette_animation', paletteAnimationProblems],
    ['molang', molangProblems],
    ['group_widths', groupWidthIssues],
    ['corners', cornerProblems],
    ['material', bodyShapeProblems],
    ['variant', swappedBodyProblems],
    ['curve_text', curveTextProblems],
    ['unused_picture', unusedPictureProblems],
    ['other', reviewProblems],
]

function rawText(issue: BundleIssue): string {
    return issue.path ? `${issue.path}: ${issue.message}` : issue.message
}

function textureOwner(spriteId: string): ProblemTarget | null {
    if (typeof Texture === 'undefined') return null
    const owner = Texture.all.find((texture) => sanitizeId(pictureStem(texture.name)) === spriteId)
    return owner ? { kind: 'texture', uuid: owner.uuid } : null
}

function animationText(name: string, rest: string, issue: BundleIssue): string {
    const subject = `Animation '${name}'`
    const track = /^tracks\.([^.]+)\.([a-z_]+(?:\.[a-z0-9_]+)?)(\[\d+\])?$/.exec(rest)
    if (track) return plainSetting(`${subject}, ${channelName(track[2])} keyframe on '${track[1]}'`, '', issue, {})
    return plainSetting(subject, rest, issue, ANIMATION_FIELDS)
}

function variantProblem(key: string, place: string, issue: BundleIssue, code: IssueCode): Problem {
    const missing = /^no layer '(.+)'$/.exec(issue.message.replace(/\.$/, ''))
    const text = missing
        ? `Variant '${key}' ${place === 'hide' ? 'hides' : 'swaps'} a layer called '${missing[1]}', which no longer exists. Open the variant and press Confirm to clear it.`
        : plainSetting(`Variant '${key}'`, place, issue, VARIANT_FIELDS)
    return { level: 'error', code, text, target: null, buttons: [editVariantButton(() => openVariantDialog(key))] }
}

function settingsProblem(issue: BundleIssue, field: string, code: IssueCode): Problem {
    const level: ProblemLevel = 'error'
    const text = /^text\.?(.*)$/.exec(field)
    if (text) return { level, code, text: plainSetting('Name text', text[1], issue, TEXT_FIELDS), target: null, buttons: [selectLayerButton(nameTextNode)] }
    const badge = /^badge\.?(.*)$/.exec(field)
    if (badge) return { level, code, text: plainSetting('The badge', badge[1], issue, BADGE_FIELDS), target: null, buttons: [selectLayerButton(badgeNode)] }
    return { level, code, text: plainSetting('Nameplate settings', field, issue, SETTINGS_FIELDS), target: null }
}

function groupProblem(index: number, field: string, issue: BundleIssue, code: IssueCode): Problem {
    const group = readGroups()[index]
    const subject = group?.id ? `Group '${group.id}'` : 'A group'
    return { level: 'error', code, text: plainSetting(subject, field, issue, GROUP_FIELDS), target: layerTarget(group?.uuid) }
}

function layerProblem(id: string, field: string, issue: BundleIssue, code: IssueCode, layers: Map<string, string>): Problem {
    const uuid = layers.get(id)
    const subject = `Layer '${id}'`
    const hold = field === 'step' ? holdText(subject, id, issue.message) : null
    const text = PICTURE_GONE.test(issue.message)
        ? `${subject} lost a picture: it was deleted. Pick another one in the Inspector, or undo the delete.`
        : hold ?? plainSetting(subject, field, issue, LAYER_FIELDS)
    return { level: 'error', code, text, target: layerTarget(uuid) }
}

function paletteText(field: string, issue: BundleIssue): string {
    const slot = /^slots\.([^.[]+)\.?(.*)$/.exec(field)
    if (slot) return plainSetting(`Color '${slot[1]}'`, slot[2], issue, COLOR_FIELDS)
    const colorway = /^colorways\.([^.[]+)\.?(.*)$/.exec(field)
    if (colorway) return plainSetting(`Colorway '${colorway[1]}'`, 'ramp', issue, COLOR_FIELDS)
    return plainSetting('Colors', '', issue, {})
}

function flagText(field: string, issue: BundleIssue): string {
    const flag = /^flags\.([^.[]+)\.?(.*)$/.exec(field)
    return flag ? plainSetting(`Flag '${flag[1]}'`, flag[2], issue, FLAG_FIELDS) : plainSetting('Flags', '', issue, {})
}

type ManifestRoute = [RegExp, (match: RegExpExecArray, issue: BundleIssue, code: IssueCode, layers: Map<string, string>) => Problem]

const MANIFEST_ROUTES: ManifestRoute[] = [
    [/^animations\.([^.]+)\.?(.*)$/, (match, issue, code) => ({ level: 'error', code, text: animationText(match[1], match[2], issue), target: animationTarget(match[1]) })],
    [/^variants\.([^.]+)\.?(.*)$/, (match, issue, code) => variantProblem(match[1], match[2], issue, code)],
    [/^layers\.([^.]+)\.?(.*)$/, (match, issue, code, layers) => layerProblem(match[1], match[2], issue, code, layers)],
    [/^groups\[(\d+)\]\.?(.*)$/, (match, issue, code) => groupProblem(Number(match[1]), match[2], issue, code)],
]

function plainIssue(issue: BundleIssue, layers: Map<string, string>): Problem {
    const level: ProblemLevel = 'error'
    const facts = classifyIssue(issue)
    const code = facts.code
    const at = issue.path.indexOf('#')
    const file = at < 0 ? issue.path : issue.path.slice(0, at)
    const field = at < 0 ? '' : issue.path.slice(at + 1)
    const layer = looseLayerId(file)
    const budget = budgetText(facts)
    if (budget) {
        const uuid = layer !== null ? layers.get(layer) : undefined
        return { level, code, text: layer !== null ? `Layer '${layer}': ${budget}` : budget, target: layerTarget(uuid) }
    }
    if (layer !== null) return layerProblem(layer, field, issue, code, layers)
    const sprite = looseSpriteId(file)
    if (sprite !== null) {
        const resize = PICTURE_SIZE.test(issue.message) ? RESIZE_ADVICE : ''
        return { level, code, text: `${plainSetting(`Picture '${sprite}'`, field, issue, SPRITE_FIELDS)}${resize}`, target: textureOwner(sprite) }
    }
    if (file === 'manifest.json') {
        for (const [pattern, problem] of MANIFEST_ROUTES) {
            const match = pattern.exec(field)
            if (match) return problem(match, issue, code, layers)
        }
        return settingsProblem(issue, field, code)
    }
    if (file === 'palettes.json') return { level, code, text: paletteText(field, issue), target: null }
    if (file === 'flags.json') return { level, code, text: flagText(field, issue), target: null }
    const material = materialProblem(issue)
    if (material) return { level, code, text: material.text, target: material.target }
    return { level, code, text: plainSetting('The nameplate', '', issue, {}), target: null }
}

export function plainIssueText(issue: BundleIssue): string {
    return plainIssue(issue, new Map()).text
}

function guideTarget(target: GuideTarget | null): ProblemTarget | null {
    if (!target) return null
    if (target.kind === 'pixel' && target.pixel) {
        const { frame, x, y } = target.pixel
        return { kind: 'pixel', uuid: target.pixel.texture, pixel: { frame, x, y } }
    }
    return { kind: target.kind === 'layer' ? 'layer' : 'texture', uuid: target.uuid }
}

function explain(issues: BundleIssue[], level: ProblemLevel): Problem[] {
    const layers = new Map(readLayers().map((layer) => [layer.id, layer.uuid]))
    const pixels = issues.filter((issue) => classifyIssue(issue).code === 'off_palette')
    const result: Problem[] = explainIssues(pixels).map((guide) => ({ level, code: guide.code, text: guide.text, target: guideTarget(guide.target) }))
    for (const issue of issues) {
        if (pixels.includes(issue)) continue
        const reaction = reactionProblem(issue)
        if (issue.animation) {
            result.push({ level, code: reaction ? 'reaction' : 'animation', text: issue.message, target: reaction ? null : animationTarget(issue.animation), buttons: reaction?.buttons })
            continue
        }
        if (reaction) {
            result.push({ level, code: 'reaction', text: reaction.text, target: null, buttons: reaction.buttons })
            continue
        }
        const palette = paletteIssueText(issue)
        if (palette) {
            result.push({ level, code: 'palette_animation', text: palette, target: null })
            continue
        }
        const guide = explainIssues([issue])[0]
        if (!guide || guide.text === rawText(issue)) {
            result.push({ ...plainIssue(issue, layers), level })
            continue
        }
        result.push({ level, code: guide.code, text: guide.text, target: guideTarget(guide.target) ?? plainIssue(issue, layers).target })
    }
    return result
}

function run([code, source]: [IssueCode, ProblemSource]): Problem[] {
    try {
        return source().map((problem) => (problem.code ? problem : { ...problem, code }))
    } catch (error) {
        console.error('[polyplus_nameplate] problem check failed', error)
        return []
    }
}

let lastProblems: { project: string, problems: ProjectProblems } | null = null

export function projectProblems(): ProjectProblems {
    if (!hasProject()) return { errors: [], warnings: [] }
    const project = String(Project.uuid)
    if (isPaintDragging() && lastProblems?.project === project) return lastProblems.problems
    const problems = freshProblems()
    lastProblems = { project, problems }
    return problems
}

function freshProblems(): ProjectProblems {
    const bundle = currentBundle()
    const checked = SOURCES.flatMap(run)
    const blocking = checked.filter((problem) => problem.level === 'error' && problem.covers)
    const open = (issue: BundleIssue) => !blocking.some((problem) => problem.covers!(issue.path))
    const errors = [...explain(bundle.issues.filter(open), 'error'), ...checked.filter((problem) => problem.level === 'error')]
    const warnings = [...explain(bundle.warnings ?? [], 'warning'), ...checked.filter((problem) => problem.level === 'warning')]
    return { errors, warnings }
}

function openAnimation(uuid: string) {
    const animation = findAnimation(uuid)
    if (!animation) return
    goMode('animate')
    animation.select()
    if (animation.name !== LOOP_ANIMATION) animation.propertiesDialog()
}

export function showProblemTarget(target: ProblemTarget | null) {
    if (!target) return
    if (target.kind === 'animation') {
        openAnimation(target.uuid)
        return
    }
    if (target.kind === 'pixel' && target.pixel) {
        jumpToPixel(target.uuid, target.pixel.frame, target.pixel.x, target.pixel.y)
        return
    }
    if (target.kind === 'texture' || target.kind === 'pixel') {
        const texture = findTexture(target.uuid)
        if (texture) paintTexture(texture)
        return
    }
    const node = findNode(target.uuid)
    if (node) showLayer(node)
}

const TARGET_BUTTONS: Record<ProblemTarget['kind'], { name: string, icon: string }> = {
    layer: SELECT_LAYER,
    texture: { name: 'Paint this picture', icon: 'brush' },
    pixel: { name: 'Show the pixel', icon: 'my_location' },
    animation: { name: 'Open animation', icon: 'movie' },
}

export function problemButtons(problem: Problem, beforeShow: () => void = () => {}): ProblemButton[] {
    const buttons: ProblemButton[] = []
    const target = problem.target
    if (target) {
        buttons.push({
            ...TARGET_BUTTONS[target.kind],
            click: () => {
                beforeShow()
                showProblemTarget(target)
            },
        })
    }
    return [...buttons, ...(problem.buttons ?? [])]
}
