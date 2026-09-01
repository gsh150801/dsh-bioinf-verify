/**
 * OpenAI-compatible chat client for the verification plugin (audits and
 * decomposition run at temperature 0; one transparent retry protects against
 * transient gateway failures).
 *
 * @module dsh-bioinf-verify/llm
 */
export interface LlmConfig {
    readonly enabled: boolean;
    readonly baseURL: string;
    readonly model: string;
    readonly apiKey: string;
}
export type ChatFn = (system: string, user: string) => Promise<string>;
export declare function makeLlmChat(config: LlmConfig, fetchImpl?: typeof fetch, temperature?: number): ChatFn;
//# sourceMappingURL=llm.d.ts.map