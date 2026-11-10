import nightCurtain from './night_lights/layers/curtain.json'
import nightSky from './night_lights/layers/sky.json'
import nightStarsLayer from './night_lights/layers/stars.json'
import nightManifest from './night_lights/manifest.json'
import nightCurtainMaterial from './night_lights/materials/curtain.json'
import nightPalettes from './night_lights/palettes.json'
import nightPreview from './night_lights/preview.png'
import nightStars from './night_lights/sprites/stars.json'
import riverClaspLayer from './river_stone/layers/clasp.json'
import riverStone from './river_stone/layers/stone.json'
import riverManifest from './river_stone/manifest.json'
import riverPalettes from './river_stone/palettes.json'
import riverPreview from './river_stone/preview.png'
import riverClasp from './river_stone/sprites/clasp.json'
import snailPlate from './snail_walk/layers/plate.json'
import snailLayer from './snail_walk/layers/snail.json'
import snailManifest from './snail_walk/manifest.json'
import snailPalettes from './snail_walk/palettes.json'
import snailPreview from './snail_walk/preview.png'
import snailSprite from './snail_walk/sprites/snail.json'
import sodaBubbles from './soda_fizz/layers/bubbles.json'
import sodaBody from './soda_fizz/layers/soda.json'
import sodaManifest from './soda_fizz/manifest.json'
import sodaPalettes from './soda_fizz/palettes.json'
import sodaPreview from './soda_fizz/preview.png'
import sodaBead from './soda_fizz/sprites/bead.json'
import sodaBubble from './soda_fizz/sprites/bubble.json'

export interface Sample {
    key: string
    name: string
    preview: string
    files: Record<string, unknown>
}

export const SAMPLES: Sample[] = [
    {
        key: 'river_stone',
        name: 'River Stone',
        preview: riverPreview,
        files: {
            'manifest.json': riverManifest,
            'palettes.json': riverPalettes,
            'layers/stone.json': riverStone,
            'layers/clasp.json': riverClaspLayer,
            'sprites/clasp.json': riverClasp,
        },
    },
    {
        key: 'snail_walk',
        name: 'Snail Walk',
        preview: snailPreview,
        files: {
            'manifest.json': snailManifest,
            'palettes.json': snailPalettes,
            'layers/plate.json': snailPlate,
            'layers/snail.json': snailLayer,
            'sprites/snail.json': snailSprite,
        },
    },
    {
        key: 'soda_fizz',
        name: 'Soda Fizz',
        preview: sodaPreview,
        files: {
            'manifest.json': sodaManifest,
            'palettes.json': sodaPalettes,
            'layers/bubbles.json': sodaBubbles,
            'layers/soda.json': sodaBody,
            'sprites/bead.json': sodaBead,
            'sprites/bubble.json': sodaBubble,
        },
    },
    {
        key: 'night_lights',
        name: 'Night Lights',
        preview: nightPreview,
        files: {
            'manifest.json': nightManifest,
            'palettes.json': nightPalettes,
            'layers/sky.json': nightSky,
            'layers/stars.json': nightStarsLayer,
            'layers/curtain.json': nightCurtain,
            'materials/curtain.json': nightCurtainMaterial,
            'sprites/stars.json': nightStars,
        },
    },
]

export function sampleByKey(key: string): Sample | null {
    return SAMPLES.find((sample) => sample.key === key) ?? null
}

export function sampleFiles(sample: Sample): Record<string, string> {
    const files: Record<string, string> = {}
    for (const [path, value] of Object.entries(sample.files)) files[path] = JSON.stringify(value)
    return files
}
