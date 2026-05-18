import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'
import type { BabyProfile } from './types.js'

function profileDir() { return path.join(dataDir(), 'profile') }
function profileFile() { return path.join(profileDir(), 'baby.json') }

function ensureDir() {
  const dir = profileDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function loadProfile(): BabyProfile | null {
  ensureDir()
  const file = profileFile()
  if (!existsSync(file)) return null
  const raw = readFileSync(file, 'utf-8')
  return JSON.parse(raw) as BabyProfile
}

export function saveProfile(profile: BabyProfile): void {
  ensureDir()
  writeFileSync(profileFile(), JSON.stringify(profile, null, 2), 'utf-8')
}

export function getGestationalWeeks(profile: BabyProfile, referenceDate?: Date): number | null {
  if (!profile.expectedBirthDate) return null
  const edd = new Date(profile.expectedBirthDate)
  const conceptionApprox = new Date(edd.getTime() - 280 * 24 * 60 * 60 * 1000)
  const ref = referenceDate || new Date()
  const diffMs = ref.getTime() - conceptionApprox.getTime()
  const weeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000))
  if (weeks < 0 || weeks > 42) return null
  return weeks
}

export function getStage(profile: BabyProfile): '孕期' | '已出生' {
  const edd = new Date(profile.expectedBirthDate)
  return new Date() < edd ? '孕期' : '已出生'
}
