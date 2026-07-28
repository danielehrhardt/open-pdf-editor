/**
 * Picks the platform at boot.
 *
 * The Tauri adapter is loaded dynamically so a static web deployment never
 * pulls the desktop IPC code into its first paint — Vite splits it into its own
 * chunk that the browser build simply never requests.
 */
import { isTauri } from '../lib/native'
import { createWebPlatform } from './web'
import type { Platform } from './types'

let current: Platform | null = null

export async function initPlatform(): Promise<Platform> {
  if (current) return current
  if (isTauri()) {
    const { createTauriPlatform } = await import('./tauri')
    current = createTauriPlatform()
  } else {
    current = createWebPlatform()
  }
  return current
}

/** The active platform. Safe to call after {@link initPlatform} has resolved. */
export function platform(): Platform {
  if (!current) throw new Error('initPlatform() has not completed yet')
  return current
}

export * from './types'
