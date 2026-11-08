/**
 * Minimal port of bloub's pointer-follow gaze rule (src/ui/gaze.ts).
 *
 * bloub — https://github.com/jeremy-prt/bloub — MIT © jeremy-prt.
 * Adapted for SecAgent: the settings-panel TURN offset is dropped (the bot
 * follows the cursor symmetrically around the screen centre), everything else
 * (yaw/pitch budget, turn-in easing with the SPIN trick, wander release when
 * no pointer) is kept as authored upstream.
 */

import type { Look } from './engine.js'

/** Duree du rattrapage de l'arrivee du regard, en secondes. */
export const TURN_TIME = 1.1

/** Amplitude du regard, en degres. */
export const YAW_MAX = 16
export const PITCH_MAX = 13

/** Tour complet applique pendant le rattrapage (le regard "arrive en tournant"). */
export const SPIN = 360

export interface Aim {
  nx: number
  ny: number
  tour: number
  pointer: boolean
}

export function lookTarget({ nx, ny, tour, pointer }: Aim): Look {
  return {
    yaw: nx * YAW_MAX,
    // tangage positif = regard vers le haut, alors que le y de l'ecran descend
    pitch: -ny * PITCH_MAX,
    mix: tour,
    spin: SPIN * (1 - tour),
    wander: pointer ? 0 : 1
  }
}
