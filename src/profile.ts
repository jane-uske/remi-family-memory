import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { BabyProfile } from './types.js'

const PROFILE_DIR = path.resolve('data/profile')
const PROFILE_FILE = path.join(PROFILE_DIR, 'baby.json')

function ensureDir() {
  if (!existsSync(PROFILE_DIR)) {
    mkdirSync(PROFILE_DIR, { recursive: true })
  }
}

export function loadProfile(): BabyProfile | null {
  ensureDir()
  if (!existsSync(PROFILE_FILE)) return null
  const raw = readFileSync(PROFILE_FILE, 'utf-8')
  return JSON.parse(raw) as BabyProfile
}

export function saveProfile(profile: BabyProfile): void {
  ensureDir()
  writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf-8')
}

export function getGestationalWeeks(profile: BabyProfile): number | null {
  if (!profile.expectedBirthDate) return null
  const edd = new Date(profile.expectedBirthDate)
  const conceptionApprox = new Date(edd.getTime() - 280 * 24 * 60 * 60 * 1000)
  const now = new Date()
  const diffMs = now.getTime() - conceptionApprox.getTime()
  const weeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000))
  if (weeks < 0 || weeks > 42) return null
  return weeks
}

export function getStage(profile: BabyProfile): '孕期' | '已出生' {
  const edd = new Date(profile.expectedBirthDate)
  return new Date() < edd ? '孕期' : '已出生'
}
