/**
 * src/app/api/webhooks/clerk/route.ts
 *
 * Clerk user lifecycle webhook handler.
 * Receives user.created, user.updated, user.deleted events from Clerk
 * and keeps our users table in sync.
 *
 * Signature verification via svix — rejects any unsigned or tampered payloads.
 */

import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { exec, one } from '@/lib/db';

type ClerkUserEvent = {
  type: 'user.created' | 'user.updated' | 'user.deleted';
  data: {
    id: string;
    email_addresses: Array<{ email_address: string; id: string }>;
    primary_email_address_id: string;
    deleted?: boolean;
  };
};

function getPrimaryEmail(data: ClerkUserEvent['data']): string | null {
  const primary = data.email_addresses.find(
    e => e.id === data.primary_email_address_id
  );
  return primary?.email_address ?? data.email_addresses[0]?.email_address ?? null;
}

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  // Read raw body and svix headers
  const payload = await req.text();
  const headersList = await headers();

  const svixHeaders = {
    'svix-id':        headersList.get('svix-id') ?? '',
    'svix-timestamp': headersList.get('svix-timestamp') ?? '',
    'svix-signature': headersList.get('svix-signature') ?? '',
  };

  // Verify signature
  let event: ClerkUserEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(payload, svixHeaders) as ClerkUserEvent;
  } catch {
    return Response.json({ error: 'Invalid webhook signature' }, { status: 400 });
  }

  const { type, data } = event;

  try {
    if (type === 'user.created') {
      const email = getPrimaryEmail(data);
      if (!email) {
        return Response.json({ error: 'No email address on user' }, { status: 400 });
      }
      await exec(
        `INSERT INTO users (id, email, tier, created_at, updated_at)
         VALUES ($1, $2, 'free', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [data.id, email]
      );
    } else if (type === 'user.updated') {
      const email = getPrimaryEmail(data);
      if (email) {
        await exec(
          `UPDATE users SET email = $2, updated_at = now() WHERE id = $1`,
          [data.id, email]
        );
      }
    } else if (type === 'user.deleted') {
      // Soft delete — preserve data for billing/audit trail
      const exists = await one(`SELECT id FROM users WHERE id = $1`, [data.id]);
      if (exists) {
        await exec(
          `UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = $1`,
          [data.id]
        );
      }
    }
  } catch (err) {
    console.error(`[clerk-webhook] ${type} failed:`, err);
    return Response.json({ error: 'Database error' }, { status: 500 });
  }

  return Response.json({ received: true });
}
