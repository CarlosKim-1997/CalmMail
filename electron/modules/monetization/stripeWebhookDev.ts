/**
 * Optional local webhook listener for Stripe CLI (`stripe listen --forward-to`).
 * Enable with CALMMAIL_STRIPE_WEBHOOK_PORT=4242 (dev only).
 */

import * as http from 'node:http';
import { applyStripeSubscriptionObject } from './stripeBilling';
import { notifyBillingChanged } from './billingNotify';
import { stripeWebhookSecret } from './billingEnv';

function parseEventBody(raw: string): { type: string; data: { object: Record<string, unknown> } } | null {
  try {
    const parsed = JSON.parse(raw) as {
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
    if (!parsed.type || !parsed.data?.object) return null;
    return { type: parsed.type, data: { object: parsed.data.object } };
  } catch {
    return null;
  }
}

export function maybeStartStripeWebhookDevServer(): void {
  const portRaw = process.env.CALMMAIL_STRIPE_WEBHOOK_PORT?.trim();
  if (!portRaw) return;
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port < 1) return;
  if (!stripeWebhookSecret()) {
    console.warn('[billing] CALMMAIL_STRIPE_WEBHOOK_PORT set but STRIPE_WEBHOOK_SECRET missing');
    return;
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/stripe/webhook') {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        const event = parseEventBody(body);
        if (!event) {
          res.writeHead(400);
          res.end('bad payload');
          return;
        }
        const subEvents = new Set([
          'customer.subscription.created',
          'customer.subscription.updated',
          'customer.subscription.deleted',
        ]);
        if (subEvents.has(event.type)) {
          const result = applyStripeSubscriptionObject(event.data.object);
          notifyBillingChanged(result);
        }
        res.writeHead(200);
        res.end('ok');
      })();
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.info(`[billing] Stripe webhook dev server on http://127.0.0.1:${port}/stripe/webhook`);
  });
}
