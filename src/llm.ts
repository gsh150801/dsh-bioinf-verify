/**
 * OpenAI-compatible chat client for the verification plugin (audits and
 * decomposition run at temperature 0; one transparent retry protects against
 * transient gateway failures).
 *
 * @module dsh-bioinf-verify/llm
 */

export interface LlmConfig {
  readonly enabled: boolean
  readonly baseURL: string
  readonly model: string
  readonly apiKey: string
}

export type ChatFn = (system: string, user: string) => Promise<string>

export function makeLlmChat(config: LlmConfig, fetchImpl?: typeof fetch, temperature = 0): ChatFn {
  const doFetch = fetchImpl ?? fetch
  return async (system, user) => {
    if (!config.enabled || config.baseURL === '') {
      throw new Error('verification LLM not configured (llmRouter in the verify plugin config)')
    }
    const body = JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: 2400,
    })
    let lastError: Error | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await doFetch(`${config.baseURL.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey !== '' ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body,
        })
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          lastError = new Error(`LLM HTTP ${res.status} ${res.statusText}`)
          await new Promise(resolvePromise => setTimeout(resolvePromise, 2500))
          continue
        }
        if (!res.ok) throw new Error(`LLM HTTP ${res.status} ${res.statusText}`)
        const payload = (await res.json()) as { choices?: Array<{ message?: { content?: unknown; reasoning?: unknown } }> }
        const message = payload.choices?.[0]?.message
        const text = message?.content ?? message?.reasoning
        const value = typeof text === 'string' ? text : ''
        if (value.trim() === '') throw new Error('LLM returned an empty answer')
        return value
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt === 0) await new Promise(resolvePromise => setTimeout(resolvePromise, 2500))
      }
    }
    throw lastError ?? new Error('LLM request failed')
  }
}
