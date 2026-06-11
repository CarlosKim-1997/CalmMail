/**
 * CLI: load .env from repo root and report whether cloud keys are set,
 * then optionally ping OpenAI / Anthropic (no secrets printed).
 *
 * Usage: npm run check:cloud
 */
const path = require('node:path');
const { config } = require('dotenv');

const root = path.join(__dirname, '..');
config({ path: path.join(root, '.env') });
config({ path: path.join(root, '.env.local'), override: true });

const openaiKey = process.env.OPENAI_API_KEY?.trim();
const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();

async function main() {
  console.log('--- CalmMail cloud env (keys not printed) ---');
  console.log('OPENAI_API_KEY set:', Boolean(openaiKey));
  console.log('ANTHROPIC_API_KEY set:', Boolean(anthropicKey));

  if (openaiKey) {
    try {
      const OpenAI = require('openai').default;
      const client = new OpenAI({ apiKey: openaiKey });
      await client.models.list();
      console.log('OpenAI models.list: OK');
    } catch (e) {
      console.log('OpenAI models.list: FAIL —', e instanceof Error ? e.message : e);
    }
  }

  if (anthropicKey) {
    try {
      const Anthropic = require('@anthropic-ai/sdk').default;
      const client = new Anthropic({ apiKey: anthropicKey });
      await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      console.log('Anthropic messages.create (1 token): OK');
    } catch (e) {
      console.log('Anthropic ping: FAIL —', e instanceof Error ? e.message : e);
    }
  }
}

void main();
