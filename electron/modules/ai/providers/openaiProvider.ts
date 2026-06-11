import type { AiProvider, BriefingInput, BriefingResult } from '../provider';
import { ProviderNotConfiguredError } from '../provider';
import { getOpenAiApiKey } from '../cloudKeys';
import { parseBriefingPayload } from '../parseBriefing';
import { planCloudBriefingRequest } from '../cloudBriefingRun';
import { briefingPerfMark } from '../briefingPerf';
import OpenAI from 'openai';

const MODEL = 'gpt-4o-mini';

export const openaiProvider: AiProvider = {
  id: 'openai',
  label: 'OpenAI (Cloud)',
  isCloud: true,

  isConfigured(): boolean {
    return Boolean(getOpenAiApiKey());
  },

  async runBriefing(input: BriefingInput): Promise<BriefingResult> {
    const plan = planCloudBriefingRequest(input);
    const client = makeClient();
    const resp = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      max_tokens: plan.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: plan.systemPrompt },
        { role: 'user', content: plan.userPrompt },
      ],
    });
    const usage = resp.usage;
    if (usage) {
      briefingPerfMark(
        'cloud_tokens',
        `openai in=${usage.prompt_tokens} out=${usage.completion_tokens} total=${usage.total_tokens} sparse=${plan.sparseTriage}`,
      );
    }
    const content = resp.choices[0]?.message?.content ?? '{}';
    return parseBriefingPayload(content, input, 'openai');
  },
};

function makeClient(): OpenAI {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new ProviderNotConfiguredError('openai');
  return new OpenAI({ apiKey });
}
