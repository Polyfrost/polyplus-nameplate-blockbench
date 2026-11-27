import assert from 'node:assert/strict'
import test from 'node:test'
import { setLayerDrawer } from '../src/engine'
import '../src/leftside/live'
import { drawCrowd } from '../src/preview/crowd'

test('behind and background layers go under the vanilla background, and over-background layers go on top of it', () => {
    const seen: string[] = []
    const ctx: any = { save() {}, restore() {}, fillRect: () => seen.push('vanilla'), globalAlpha: 1 }
    const layer = (id: string, depth: string, index: number) => ({ layer: id, depth, index, rasterWidth: 1, rasterHeight: 1, rgba: new Uint8ClampedArray(4), opacity: 255 }) as any
    setLayerDrawer((_, layers) => seen.push(...layers.map((item) => item.layer)))
    try {
        const tag: any = {
            layers: [layer('front', 'over_text', 0), layer('over', 'over_background', 1), layer('back', 'background', 2), layer('under', 'behind', 3)],
            background: { x0: 0, y0: 0, x1: 4, y1: 4 },
            padded: false,
            runs: [],
            plate: { dx: 0, dy: 0 },
            badge: null,
        }
        drawCrowd(ctx, [{ tag, box: { minX: 0, minY: 0, width: 4, height: 4 }, x: 0, y: 0 }], 1, 0, true)
        assert.deepEqual(seen, ['back', 'under', 'vanilla', 'over', 'front'])
    } finally {
        setLayerDrawer(null)
    }
})
