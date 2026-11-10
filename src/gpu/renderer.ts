import { MaterialDraw, NameplatePreview, ShaderSource, ShaderTexture, TexturePixels, UNIFORM_WORDS } from '../engine'
import { atlasFrame, placeholderArt } from './placeholder'

export interface ShaderFailure {
    key: string
    material: string
    log: string
}

interface Program {
    program: WebGLProgram
    source: ShaderSource
    locations: Map<string, WebGLUniformLocation | null>
    position: number
    color: number
    uv: number
}

interface GpuTexture {
    texture: WebGLTexture
    width: number
    height: number
    frames: number
}

export interface Light {
    r: number
    g: number
    b: number
}

export interface Placement {
    scale: number
    originX: number
    originY: number
}

export interface ScreenRect {
    x: number
    y: number
    width: number
    height: number
}

const PROGRAM_LIMIT = 64
const TEXTURE_LIMIT = 48
const FLOATS_PER_VERTEX = 9
const ATLAS_LANES = 16

const state: {
    canvas: HTMLCanvasElement | null
    gl: WebGL2RenderingContext | null
    unavailable: boolean
    buffer: WebGLBuffer | null
    programs: Map<string, Program | ShaderFailure>
    textures: Map<object, GpuTexture>
    framebuffer: WebGLFramebuffer | null
    target: WebGLTexture | null
    targetSize: [number, number]
} = {
    canvas: null,
    gl: null,
    unavailable: false,
    buffer: null,
    programs: new Map(),
    textures: new Map(),
    framebuffer: null,
    target: null,
    targetSize: [0, 0],
}

function reset() {
    state.gl = null
    state.buffer = null
    state.programs.clear()
    state.textures.clear()
    state.framebuffer = null
    state.target = null
    state.targetSize = [0, 0]
}

function context(): WebGL2RenderingContext | null {
    if (state.gl && !state.gl.isContextLost()) return state.gl
    if (state.unavailable) return null
    try {
        if (!state.canvas) {
            state.canvas = document.createElement('canvas')
            state.canvas.addEventListener('webglcontextlost', (event) => {
                event.preventDefault()
                reset()
            })
        }
        reset()
        const gl = state.canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, alpha: true })
        if (!gl) {
            state.unavailable = true
            return null
        }
        if (gl.isContextLost()) return null
        state.gl = gl
        state.buffer = gl.createBuffer()
        return gl
    } catch (error) {
        console.error('[polyplus_nameplate] WebGL2 is not available', error)
        state.unavailable = true
        return null
    }
}

export function gpuAvailable(): boolean {
    return !!context()
}

export function shaderFailures(): ShaderFailure[] {
    const failures: ShaderFailure[] = []
    for (const entry of state.programs.values()) if (isFailure(entry)) failures.push(entry)
    return failures
}

function isFailure(entry: Program | ShaderFailure): entry is ShaderFailure {
    return !('program' in entry)
}

function compileStage(gl: WebGL2RenderingContext, type: number, text: string): { shader: WebGLShader | null, log: string } {
    const shader = gl.createShader(type)
    if (!shader) return { shader: null, log: 'could not create a shader' }
    gl.shaderSource(shader, text)
    gl.compileShader(shader)
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return { shader, log: '' }
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error'
    gl.deleteShader(shader)
    return { shader: null, log }
}

function build(gl: WebGL2RenderingContext, source: ShaderSource): Program | ShaderFailure {
    const vertex = compileStage(gl, gl.VERTEX_SHADER, source.vertex)
    const fragment = compileStage(gl, gl.FRAGMENT_SHADER, source.fragment)
    const fail = (log: string): ShaderFailure => ({ key: source.key, material: source.materialId, log })
    if (!vertex.shader || !fragment.shader) {
        if (vertex.shader) gl.deleteShader(vertex.shader)
        if (fragment.shader) gl.deleteShader(fragment.shader)
        return fail(vertex.log || fragment.log)
    }
    const program = gl.createProgram()
    if (!program) return fail('could not create a program')
    gl.attachShader(program, vertex.shader)
    gl.attachShader(program, fragment.shader)
    gl.linkProgram(program)
    gl.deleteShader(vertex.shader)
    gl.deleteShader(fragment.shader)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) ?? 'link failed'
        gl.deleteProgram(program)
        return fail(log)
    }
    return {
        program,
        source,
        locations: new Map(),
        position: gl.getAttribLocation(program, 'Position'),
        color: gl.getAttribLocation(program, 'Color'),
        uv: gl.getAttribLocation(program, 'UV0'),
    }
}

function programFor(gl: WebGL2RenderingContext, source: ShaderSource): Program | null {
    let entry = state.programs.get(source.key)
    if (!entry) {
        entry = build(gl, source)
        state.programs.set(source.key, entry)
        if (isFailure(entry)) console.warn(`[polyplus_nameplate] effect ${source.materialId} could not be built on the graphics card; its CPU version shows`, entry.log)
        while (state.programs.size > PROGRAM_LIMIT) {
            const oldest = state.programs.keys().next().value as string
            const dropped = state.programs.get(oldest)
            if (dropped && !isFailure(dropped)) gl.deleteProgram(dropped.program)
            state.programs.delete(oldest)
        }
    }
    return isFailure(entry) ? null : entry
}

function location(gl: WebGL2RenderingContext, program: Program, name: string): WebGLUniformLocation | null {
    if (!program.locations.has(name)) program.locations.set(name, gl.getUniformLocation(program.program, name))
    return program.locations.get(name) ?? null
}

function upload(gl: WebGL2RenderingContext, owner: object, pixels: TexturePixels, frames: number): GpuTexture | null {
    const hit = state.textures.get(owner)
    if (hit) {
        state.textures.delete(owner)
        state.textures.set(owner, hit)
        return hit
    }
    const texture = gl.createTexture()
    if (!texture) return null
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pixels.width, pixels.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels.rgba)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const entry = { texture, width: pixels.width, height: pixels.height, frames }
    state.textures.set(owner, entry)
    while (state.textures.size > TEXTURE_LIMIT) {
        const oldest = state.textures.keys().next().value as object
        const dropped = state.textures.get(oldest)
        if (dropped) gl.deleteTexture(dropped.texture)
        state.textures.delete(oldest)
    }
    return entry
}

function textureFor(gl: WebGL2RenderingContext, preview: NameplatePreview, ref: ShaderTexture): GpuTexture | null {
    if (ref.kind === 'bundle') {
        const pixels = preview.texture(ref.path)
        return pixels ? upload(gl, pixels, pixels, 1) : null
    }
    const art = placeholderArt(ref.kind, ref.id)
    return upload(gl, art, art, art.frames)
}

function bindTextures(gl: WebGL2RenderingContext, program: Program, preview: NameplatePreview, frame: number): Float32Array | null {
    const atlas = new Float32Array(ATLAS_LANES)
    for (const ref of program.source.textures) {
        const texture = textureFor(gl, preview, ref)
        if (!texture) return null
        gl.activeTexture(gl.TEXTURE0 + ref.unit)
        gl.bindTexture(gl.TEXTURE_2D, texture.texture)
        gl.uniform1i(location(gl, program, ref.sampler), ref.unit)
        if (ref.kind === 'atlas' && ref.unit < ATLAS_LANES / 4) {
            const height = texture.height / Math.max(1, texture.frames)
            atlas.set([0, (frame % Math.max(1, texture.frames)) * height, texture.width, height], ref.unit * 4)
        }
    }
    return atlas
}

function prepare(gl: WebGL2RenderingContext, preview: NameplatePreview, draw: MaterialDraw, atlasAt: number): Program | null {
    const source = preview.shader(draw.key)
    if (!source) return null
    const program = programFor(gl, source)
    if (!program) return null
    gl.useProgram(program.program)
    const atlas = bindTextures(gl, program, preview, atlasAt)
    if (!atlas) return null
    const words = draw.uniforms
    const floats = new Float32Array(words.buffer, words.byteOffset, words.length)
    const hasAtlas = source.textures.some((ref) => ref.kind === 'atlas')
    gl.uniform4fv(location(gl, program, 'AreaRect'), floats.subarray(UNIFORM_WORDS.area, UNIFORM_WORDS.area + 4))
    gl.uniform4fv(location(gl, program, 'BodyRect'), floats.subarray(UNIFORM_WORDS.body, UNIFORM_WORDS.body + 4))
    gl.uniform4iv(location(gl, program, 'NameplateClock'), words.subarray(UNIFORM_WORDS.clock, UNIFORM_WORDS.clock + 4))
    gl.uniform4fv(location(gl, program, 'Inputs'), floats.subarray(UNIFORM_WORDS.inputs, UNIFORM_WORDS.atlas))
    gl.uniform4fv(location(gl, program, 'AtlasRects'), hasAtlas ? atlas : floats.subarray(UNIFORM_WORDS.atlas, UNIFORM_WORDS.tones))
    gl.uniform4fv(location(gl, program, 'Tones'), floats.subarray(UNIFORM_WORDS.tones, UNIFORM_WORDS.tones + source.tones * 4))
    gl.uniform4f(location(gl, program, 'ColorModulator'), 1, 1, 1, 1)
    gl.uniformMatrix4fv(location(gl, program, 'ModelViewMat'), false, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))
    return program
}

function setScreen(gl: WebGL2RenderingContext, program: Program, width: number, height: number) {
    gl.uniformMatrix4fv(location(gl, program, 'ProjMat'), false, new Float32Array([2 / width, 0, 0, 0, 0, -2 / height, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]))
    gl.uniform2f(location(gl, program, 'ScreenSize'), width, height)
}

function quad(
    gl: WebGL2RenderingContext,
    program: Program,
    rect: ScreenRect,
    local: Int32Array,
    mirrorX: boolean,
    color: [number, number, number, number],
) {
    const x0 = rect.x
    const y0 = rect.y
    const x1 = rect.x + rect.width
    const y1 = rect.y + rect.height
    const uLeft = mirrorX ? local[2] : local[0]
    const uRight = mirrorX ? local[0] : local[2]
    const vTop = local[1]
    const vBottom = local[3]
    const [r, g, b, a] = color
    const data = new Float32Array([
        x0, y1, 0, r, g, b, a, uLeft, vBottom,
        x1, y1, 0, r, g, b, a, uRight, vBottom,
        x0, y0, 0, r, g, b, a, uLeft, vTop,
        x1, y0, 0, r, g, b, a, uRight, vTop,
    ])
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW)
    const stride = FLOATS_PER_VERTEX * 4
    const attribute = (index: number, size: number, offset: number) => {
        if (index < 0) return
        gl.enableVertexAttribArray(index)
        gl.vertexAttribPointer(index, size, gl.FLOAT, false, stride, offset * 4)
    }
    attribute(program.position, 3, 0)
    attribute(program.color, 4, 3)
    attribute(program.uv, 2, 7)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

function localRect(draw: MaterialDraw, local: ArrayLike<number>, placement: Placement): ScreenRect {
    const left = draw.mirrorX ? draw.x + draw.width - local[2] : draw.x + local[0]
    const top = draw.y + local[1]
    return {
        x: placement.originX + left * placement.scale,
        y: placement.originY + top * placement.scale,
        width: (local[2] - local[0]) * placement.scale,
        height: (local[3] - local[1]) * placement.scale,
    }
}

export function materialRect(draw: MaterialDraw, placement: Placement): ScreenRect {
    return localRect(draw, draw.area, placement)
}

export function clipRects(draw: MaterialDraw): Int32Array[] {
    const clip = (draw as MaterialDraw & { clip?: ArrayLike<number> | null }).clip
    if (!clip) return [draw.area]
    const rects: Int32Array[] = []
    for (let at = 0; at + 3 < clip.length; at += 4) {
        if (clip[at + 2] > clip[at] && clip[at + 3] > clip[at + 1]) rects.push(Int32Array.from([clip[at], clip[at + 1], clip[at + 2], clip[at + 3]]))
    }
    return rects
}

function clipped(rect: ScreenRect, width: number, height: number): ScreenRect | null {
    const x0 = Math.max(0, Math.floor(rect.x))
    const y0 = Math.max(0, Math.floor(rect.y))
    const x1 = Math.min(width, Math.ceil(rect.x + rect.width))
    const y1 = Math.min(height, Math.ceil(rect.y + rect.height))
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null
}

export function renderMaterial(
    ctx: CanvasRenderingContext2D,
    preview: NameplatePreview,
    draw: MaterialDraw,
    placement: Placement,
    light: Light,
): boolean {
    const gl = context()
    const canvas = state.canvas
    if (!gl || !canvas) return false
    const width = ctx.canvas.width
    const height = ctx.canvas.height
    const rect = materialRect(draw, placement)
    const region = clipped(rect, width, height)
    if (!region) return true
    if (draw.opacity <= 0) return true
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(region.x, height - region.y - region.height, region.width, region.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const program = prepare(gl, preview, draw, atlasFrame())
    if (!program) {
        gl.disable(gl.SCISSOR_TEST)
        return false
    }
    setScreen(gl, program, width, height)
    gl.uniform4f(location(gl, program, 'NameplateLight'), light.r, light.g, light.b, 1)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const fade = Math.max(0, Math.min(255, draw.opacity)) / 255
    const additive = draw.blend === 'additive'
    const color: [number, number, number, number] = additive ? [fade, fade, fade, 1] : [1, 1, 1, fade]
    for (const local of clipRects(draw)) quad(gl, program, localRect(draw, local, placement), local, draw.mirrorX, color)
    gl.disable(gl.BLEND)
    gl.disable(gl.SCISSOR_TEST)
    ctx.save()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over'
    ctx.drawImage(canvas, region.x, region.y, region.width, region.height, region.x, region.y, region.width, region.height)
    ctx.restore()
    return true
}

function parityTarget(gl: WebGL2RenderingContext, width: number, height: number): boolean {
    if (!state.framebuffer) state.framebuffer = gl.createFramebuffer()
    if (!state.target || state.targetSize[0] !== width || state.targetSize[1] !== height) {
        if (state.target) gl.deleteTexture(state.target)
        state.target = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, state.target)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        state.targetSize = [width, height]
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state.target, 0)
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
}

export function renderParity(preview: NameplatePreview, draw: MaterialDraw): Uint8Array | null {
    const gl = context()
    if (!gl) return null
    const area = draw.area
    const width = area[2] - area[0]
    const height = area[3] - area[1]
    if (width <= 0 || height <= 0) return null
    if (!parityTarget(gl, width, height)) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        return null
    }
    gl.viewport(0, 0, width, height)
    gl.disable(gl.SCISSOR_TEST)
    gl.disable(gl.BLEND)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const program = prepare(gl, preview, draw, 0)
    if (!program) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        return null
    }
    setScreen(gl, program, width, height)
    gl.uniform4f(location(gl, program, 'NameplateLight'), 1, 1, 1, 1)
    for (const local of clipRects(draw)) {
        quad(gl, program, { x: local[0] - area[0], y: local[1] - area[1], width: local[2] - local[0], height: local[3] - local[1] }, local, false, [1, 1, 1, 1])
    }
    const raw = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const rows = new Uint8Array(raw.length)
    const stride = width * 4
    for (let row = 0; row < height; row++) rows.set(raw.subarray(row * stride, row * stride + stride), (height - 1 - row) * stride)
    return rows
}
