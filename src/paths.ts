import path from 'node:path'

export function dataDir(): string {
  return path.resolve(process.env.REMI_DATA_DIR || 'data')
}
