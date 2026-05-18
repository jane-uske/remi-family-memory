import type { LLMAdapter, AdapterType } from './types.js'
import { DeterministicAdapter } from './deterministic.js'
import { CloudAdapter } from './cloud.js'
import type { CloudConfig } from './cloud.js'

export type { LLMAdapter, LLMInput, LLMOutput, EvidencePayload, EvidencePayloadItem, PayloadAudit, SourceRef, AdapterType } from './types.js'
export { DeterministicAdapter } from './deterministic.js'
export { CloudAdapter, isBroadHealthQuestion, containsBannedBroadConclusion } from './cloud.js'
export type { CloudConfig } from './cloud.js'

export function getAdapterConfig(): { type: AdapterType; cloudConfig?: CloudConfig } {
  const provider = process.env.FAMILY_MEMORY_LLM_PROVIDER
  const apiKey = process.env.FAMILY_MEMORY_LLM_API_KEY
  const model = process.env.FAMILY_MEMORY_LLM_MODEL

  if (provider && apiKey && model) {
    return {
      type: 'cloud',
      cloudConfig: {
        provider,
        apiKey,
        model,
        baseUrl: process.env.FAMILY_MEMORY_LLM_BASE_URL,
      },
    }
  }

  return { type: 'deterministic' }
}

export function createAdapter(type?: AdapterType, cloudConfig?: CloudConfig): LLMAdapter {
  const config = type ? { type, cloudConfig } : getAdapterConfig()

  switch (config.type) {
    case 'cloud':
      if (!config.cloudConfig) {
        throw new Error('Cloud adapter requires cloudConfig (provider, apiKey, model)')
      }
      return new CloudAdapter(config.cloudConfig)
    case 'local':
      throw new Error('Local LLM adapter not yet implemented — reserved for future use')
    case 'deterministic':
    default:
      return new DeterministicAdapter()
  }
}
