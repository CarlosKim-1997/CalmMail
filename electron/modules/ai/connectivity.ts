/**
 * Lightweight cloud API checks (keys never leave this process; no UI logging).
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { CloudConnectivityPingRow } from '@shared/types';
import { getAnthropicApiKey, getOpenAiApiKey } from './cloudKeys';
import { listProviders } from './registry';

function trimMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 220 ? `${m.slice(0, 220)}…` : m;
}

async function pingOpenAi(): Promise<{ ok: boolean; message: string }> {
  const key = getOpenAiApiKey();
  if (!key) return { ok: false, message: 'no_key' };
  try {
    const client = new OpenAI({ apiKey: key });
    await client.models.list();
    return { ok: true, message: 'list_ok' };
  } catch (e) {
    return { ok: false, message: trimMsg(e) };
  }
}

async function pingAnthropic(): Promise<{ ok: boolean; message: string }> {
  const key = getAnthropicApiKey();
  if (!key) return { ok: false, message: 'no_key' };
  try {
    const client = new Anthropic({ apiKey: key });
    await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { ok: true, message: 'message_ok' };
  } catch (e) {
    return { ok: false, message: trimMsg(e) };
  }
}

/** Pings each *configured* cloud provider; rows for all cloud providers in registry. */
export async function pingCloudConnectivity(): Promise<CloudConnectivityPingRow[]> {
  const providers = listProviders().filter((p) => p.isCloud);
  const rows: CloudConnectivityPingRow[] = [];

  for (const p of providers) {
    const configured = p.isConfigured();
    if (!configured) {
      rows.push({
        id: p.id,
        label: p.label,
        configured: false,
        ok: false,
        message: 'not_configured',
      });
      continue;
    }

    if (p.id === 'openai') {
      const r = await pingOpenAi();
      rows.push({ id: p.id, label: p.label, configured: true, ok: r.ok, message: r.message });
    } else if (p.id === 'anthropic') {
      const r = await pingAnthropic();
      rows.push({ id: p.id, label: p.label, configured: true, ok: r.ok, message: r.message });
    } else {
      rows.push({
        id: p.id,
        label: p.label,
        configured: true,
        ok: false,
        message: 'ping_not_implemented',
      });
    }
  }

  return rows;
}
