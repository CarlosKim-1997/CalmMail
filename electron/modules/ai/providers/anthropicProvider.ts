import type { AiProvider, BriefingInput, BriefingResult } from '../provider';
import { ProviderNotConfiguredError } from '../provider';
import { getAnthropicApiKey } from '../cloudKeys';
import { parseBriefingPayload } from '../parseBriefing';
import { planCloudBriefingRequest } from '../cloudBriefingRun';
import { briefingPerfMark } from '../briefingPerf';
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-3-5-haiku-latest';

export const anthropicProvider: AiProvider = {
  id: 'anthropic',
  label: 'Anthropic Claude (Cloud)',
  isCloud: true,

  isConfigured(): boolean {
    return Boolean(getAnthropicApiKey());
  },

  async runBriefing(input: BriefingInput): Promise<BriefingResult> {
    const plan = planCloudBriefingRequest(input);
    const apiKey = getAnthropicApiKey();
    if (!apiKey) throw new ProviderNotConfiguredError('anthropic');
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: plan.maxTokens,
      temperature: 0.2,
      system: plan.systemPrompt,
      messages: [{ role: 'user', content: plan.userPrompt }],
    });
    if (resp.usage) {
      briefingPerfMark(
        'cloud_tokens',
        `anthropic in=${resp.usage.input_tokens} out=${resp.usage.output_tokens} sparse=${plan.sparseTriage}`,
      );
    }
    const text = resp.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim();
    return parseBriefingPayload(text, input, 'anthropic');
  },
};
