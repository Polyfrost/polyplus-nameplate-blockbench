import { DESIGN_MODE } from '../navigate'
import { isPlaying, previewUi, redraw } from '../preview'
import { crowdKeys } from '../preview/crowd'
import { fireOneShot, isLiveOnStage, MAIN_TAG, setReaction } from '../preview/live'
import { setGameLook, syncOptionItems } from '../preview/menu'
import { isReduced, ReactionEntry, ShotEntry, tryUi } from './live'
import { registerLeftPanel } from './register'

const TRY_PANEL = 'polyplus_nameplate_try'
export const CROWD_TOGGLE = 'polyplus_nameplate_crowd'

const MAX_SEED = 9999

function setReduced(on: boolean) {
    tryUi.reduced = on
    if (on === isReduced()) return
    setGameLook(on ? 'reduced' : 'full')
    syncOptionItems()
}

export function setCrowdView(on: boolean) {
    previewUi.crowd = on
    tryUi.crowd = on
    const toggle = (BarItems as any)[CROWD_TOGGLE] as Toggle | undefined
    if (toggle && toggle.value !== on) {
        toggle.value = on
        toggle.updateEnabledState?.()
    }
    redraw(false)
}

export function startPlaying() {
    if (previewUi.playing || typeof Modes === 'undefined' || Modes.id !== DESIGN_MODE) return
    const play = (BarItems as any).polyplus_nameplate_play as Action | undefined
    play?.trigger?.()
}

const component = {
    data() {
        return { ui: tryUi, maxSeed: MAX_SEED }
    },
    methods: {
        toggleReaction(entry: ReactionEntry) {
            setReaction(entry.id, !entry.on, !isPlaying())
            entry.on = !entry.on
            redraw(false)
        },
        fire(entry: ShotEntry) {
            if (!isLiveOnStage()) {
                tryUi.shot = ''
                tryUi.message = `The preview is showing the animation selected in Animate. Select the loop animation to try '${entry.label}'.`
                return
            }
            const keys = previewUi.crowd ? crowdKeys() : [MAIN_TAG]
            const fired = fireOneShot(entry.name, keys)
            tryUi.shot = entry.name
            tryUi.message = fired > 0
                ? `Playing '${entry.label}'.`
                : `'${entry.label}' is already playing. It plays to the end before it can start again.`
            startPlaying()
            redraw(false)
        },
        changeSeed(value: number) {
            const seed = Math.max(0, Math.min(MAX_SEED, Math.round(Number(value)) || 0))
            tryUi.seed = seed
            previewUi.seed = seed
            redraw(false)
        },
        toggleCrowd() {
            setCrowdView(!tryUi.crowd)
        },
        toggleReduced() {
            setReduced(!tryUi.reduced)
        },
    },
    template: `
        <div class="np-left-host"><div class="np-left-scroll mobile_scrollbar">
        <div class="np-try">
            <p v-if="!ui.hasPreview" class="np-left-empty">Fix the problems in Checks to try the nameplate out.</p>
            <div class="bar np-tick" @click="toggleCrowd()">
                <input type="checkbox" :checked="ui.crowd" @click.stop="toggleCrowd()">
                <label>Show {{ ui.crowdSize }} players at once</label>
            </div>
            <template v-if="ui.hasPreview">
                <p class="panel_toolbar_label">Pretend the player is...</p>
                <div v-for="entry in ui.reactions" :key="entry.id" class="bar np-tick" @click="toggleReaction(entry)">
                    <input type="checkbox" :checked="entry.on" @click.stop="toggleReaction(entry)">
                    <label>{{ entry.label }}</label>
                </div>
                <p v-if="!ui.reactions.length" class="np-left-note">This nameplate doesn't react to anything the player does.</p>

                <p class="panel_toolbar_label">Player's motion setting</p>
                <div class="bar np-tick" title="Shows what players with Nameplate motion turned down see" @click="toggleReduced()">
                    <input type="checkbox" :checked="ui.reduced" @click.stop="toggleReduced()">
                    <label>Reduced motion</label>
                </div>
                <p v-if="ui.reduced" class="np-left-note">Paths, particles and one-shots stop. Reactions hold still or skip.</p>

                <p class="panel_toolbar_label">Play a one-shot</p>
                <div v-if="ui.oneShots.length" class="np-shots">
                    <button v-for="entry in ui.oneShots" :key="entry.name" type="button" @click="fire(entry)">
                        <i class="material-icons notranslate icon">play_arrow</i>{{ entry.label }}
                    </button>
                </div>
                <p v-else class="np-left-note">This nameplate has no one-shot animations.</p>
                <p v-if="ui.message" class="np-left-note">{{ ui.message }}</p>

                <p class="panel_toolbar_label">Player seed</p>
                <div class="bar slider_input_combo" title="Each player gets their own seed. It decides when random events play">
                    <input type="range" class="tool" min="0" :max="maxSeed" step="1" :value="ui.seed" @input="changeSeed($event.target.value)">
                    <numeric-input class="tool" :value="ui.seed" :min="0" :max="maxSeed" :step="1" @input="changeSeed($event)" />
                </div>
                <p class="np-left-note">Each player gets their own seed. It decides when random events play{{ ui.crowd ? ', and every player in the crowd gets a different one' : '' }}.</p>
            </template>
        </div>
        </div></div>
    `,
}

export function registerTryPanel(): () => void {
    return registerLeftPanel({ id: TRY_PANEL, name: 'Try it', icon: 'play_circle_outline', index: 22, height: 300, resizable: true, growable: false, component }).remove
}
