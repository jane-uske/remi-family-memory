import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { callVlm, getVlmConfig } from './local_vlm_extractor.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function has(name: string): boolean {
  return process.argv.includes(name)
}

function usage(exitCode = 0): never {
  console.log(`Usage:
  npm run vlm:smoke -- --list-models
  npm run vlm:smoke -- --image ./data/inbox/assets/example.png
  VLM_MODEL="<model-id>" npm run vlm:smoke -- --image ./data/inbox/assets/example.png

Env:
  VLM_BASE_URL    default: http://localhost:1234/v1
  VLM_MODEL       required for --image
  VLM_TIMEOUT_MS  default: 120000
`)
  process.exit(exitCode)
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

function baseUrl(): string {
  return (arg('--base-url') || process.env.VLM_BASE_URL || 'http://localhost:1234/v1').replace(/\/$/, '')
}

async function listModels(): Promise<void> {
  const url = `${baseUrl()}/models`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
  }
  const json = await res.json() as any
  const ids = Array.isArray(json.data) ? json.data.map((m: any) => m.id).filter(Boolean) : []
  if (ids.length === 0) {
    console.log(JSON.stringify(json, null, 2))
    return
  }
  console.log(ids.join('\n'))
}

async function smokeImage(imagePath: string): Promise<void> {
  const config = getVlmConfig()
  if (!config) {
    throw new Error('VLM_MODEL is not set. Run `npm run vlm:smoke -- --list-models` first, then set VLM_MODEL to one of the printed ids.')
  }
  const absolutePath = path.resolve(imagePath)
  if (!existsSync(absolutePath)) {
    throw new Error(`Image not found: ${imagePath}`)
  }

  const result = await callVlm(readFileSync(absolutePath), mimeFor(absolutePath), {
    ...config,
    baseUrl: baseUrl(),
  })

  if (!result.ok) {
    throw new Error(`${result.reason}: ${result.message}`)
  }

  console.log(JSON.stringify({
    output: result.output,
    validationWarnings: result.validationWarnings,
    rawResponseLength: result.rawResponseLength,
  }, null, 2))
}

async function main(): Promise<void> {
  if (has('--help') || has('-h')) usage(0)
  if (has('--list-models')) {
    await listModels()
    return
  }
  const image = arg('--image')
  if (!image) usage(1)
  await smokeImage(image)
}

main().catch((err) => {
  console.error(`[vlm:smoke] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
