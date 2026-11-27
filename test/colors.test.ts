import assert from 'node:assert/strict'
import test from 'node:test'
import { setBrushColor } from '../src/cosmetic/colors'

function fakeBlockbench() {
    const seen: { color: string, blend: string } = { color: '', blend: 'default' }
    const brush = { tool_settings: { brush_opacity: 100 } }
    const scope = globalThis as any
    scope.ColorPanel = { set: (color: string) => { seen.color = color } }
    scope.settings = { opacity_range: { value: 100 } }
    scope.BarItems = {
        brush_tool: brush,
        slider_brush_opacity: { get: () => brush.tool_settings.brush_opacity, update() {} },
        blend_mode: { get value() { return seen.blend }, set(value: string) { seen.blend = value } },
    }
    return { seen, brush, done: () => { delete scope.ColorPanel; delete scope.settings; delete scope.BarItems } }
}

test('picking a see-through palette shade keeps its opacity on the brush', () => {
    const fake = fakeBlockbench()
    try {
        setBrushColor('#80FF4000')
        assert.equal(fake.seen.color, '#FF4000')
        assert.equal(fake.brush.tool_settings.brush_opacity, 50)
        assert.equal(fake.seen.blend, 'set_opacity')
        setBrushColor('#FF102030')
        assert.equal(fake.seen.color, '#102030')
        assert.equal(fake.brush.tool_settings.brush_opacity, 100)
        assert.equal(fake.seen.blend, 'default')
    } finally {
        fake.done()
    }
})
