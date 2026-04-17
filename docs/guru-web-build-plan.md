# guru-web — TypeScript Build Plan

## Repository: `guru-web`

Separate repo from the Python pipeline (`guru-pipeline`). The two repos share no code, no dependencies, and no build steps. The integration contract is a loaded Postgres database — the Python pipeline produces `guru-corpus.sql.gz`, which gets loaded into the same Postgres instance that `guru-web` reads at runtime.

---

## 1. Project Bootstrap

### 1.1 Scaffold

```bash
npx create-next-app@latest guru-web \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*"
```

Tailwind is included for utility classes in layout and spacing, but the core design system uses the token-based inline styles from the prototype. Tailwind handles the boring parts (responsive containers, flex gaps, screen breakpoints); tokens handle the aesthetic.

### 1.2 Dependencies

```bash
# Core
npm install openai pg @clerk/nextjs stripe svix

# Dev
npm install -D @types/pg
```

| Package | Purpose |
|---------|---------|
| `openai` | OpenRouter client (OpenAI-compatible SDK) |
| `pg` | Postgres driver (pgvector queries via raw SQL) |
| `@clerk/nextjs` | Auth middleware, session management, UI components |
| `stripe` | Subscription management, webhook verification |
| `svix` | Clerk webhook signature verification |

No ORM. Raw SQL with `pg`. The queries are simple, the schema is stable, and an ORM adds a layer of abstraction that makes pgvector queries harder to write and debug.

### 1.3 Environment Variables

```env
# .env.local (development)

# Postgres
DATABASE_URL=postgresql://guru:password@localhost:5432/guru

# OpenRouter
OPENROUTER_API_KEY=sk-or-...

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

---

## 2. Project Structure

```
guru-web/
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Root layout (Clerk provider, fonts, global styles)
│   │   ├── page.tsx                  # Landing page (public)
│   │   ├── sign-in/[[...sign-in]]/
│   │   │   └── page.tsx              # Clerk sign-in page
│   │   ├── sign-up/[[...sign-up]]/
│   │   │   └── page.tsx              # Clerk sign-up page
│   │   │
│   │   ├── (app)/                    # Authenticated app shell
│   │   │   ├── layout.tsx            #   Nav bar, auth gate
│   │   │   ├── chat/
│   │   │   │   └── page.tsx          #   Main query interface
│   │   │   ├── chat/[sessionId]/
│   │   │   │   └── page.tsx          #   Existing session view
│   │   │   ├── history/
│   │   │   │   └── page.tsx          #   Session list
│   │   │   ├── settings/
│   │   │   │   └── page.tsx          #   Tradition scope config
│   │   │   └── account/
│   │   │       └── page.tsx          #   Billing + account details
│   │   │
│   │   └── api/
│   │       ├── query/
│   │       │   └── route.ts          # POST: run a query (core endpoint)
│   │       ├── sessions/
│   │       │   └── route.ts          # GET: list sessions, POST: create session
│   │       ├── sessions/[id]/
│   │       │   └── route.ts          # GET: session messages
│   │       ├── preferences/
│   │       │   └── route.ts          # GET/PUT: user tradition scope
│   │       ├── webhooks/
│   │       │   ├── clerk/
│   │       │   │   └── route.ts      # Clerk user lifecycle events
│   │       │   └── stripe/
│   │       │       └── route.ts      # Stripe subscription events
│   │       └── checkout/
│   │           └── route.ts          # POST: create Stripe checkout session
│   │
│   ├── lib/
│   │   ├── db.ts                     # Postgres connection pool + query helpers
│   │   ├── retriever.ts              # Hybrid retrieval (vector + graph)
│   │   ├── graph.ts                  # Concept graph SQL queries
│   │   ├── embed.ts                  # Query embedding via OpenRouter
│   │   ├── compress.ts               # Extractive compression
│   │   ├── budget.ts                 # TokenBudget
│   │   ├── prompt.ts                 # Prompt assembly + system prompt template
│   │   ├── model.ts                  # OpenRouter completion client
│   │   ├── auth.ts                   # requireUser(), requireTier()
│   │   ├── quota.ts                  # Rate limit check + increment
│   │   ├── prefs.ts                  # UserPreferences type + load/save
│   │   └── types.ts                  # Shared types (Chunk, Citation, Session, etc.)
│   │
│   ├── components/
│   │   ├── nav-bar.tsx               # Top navigation (responsive, hamburger on mobile)
│   │   ├── citation.tsx              # Tradition-colored citation block
│   │   ├── chat-input.tsx            # Query input bar with quota display
│   │   ├── chat-message.tsx          # User/assistant message rendering
│   │   ├── tradition-badge.tsx       # Color-coded tradition pill
│   │   ├── scope-panel.tsx           # Tradition/text toggle tree
│   │   ├── plan-card.tsx             # Free/Pro plan comparison card
│   │   ├── session-card.tsx          # Session history list item
│   │   └── usage-bar.tsx             # Daily usage progress bar
│   │
│   └── styles/
│       ├── tokens.ts                 # Design tokens (colors, fonts, spacing)
│       └── globals.css               # Font imports, scrollbar, selection, resets
│
├── migrations/
│   ├── 001_users.sql
│   ├── 002_sessions_queries.sql
│   ├── 003_preferences.sql
│   └── 004_quota.sql
│
├── scripts/
│   ├── migrate.ts                    # Run SQL migrations against DATABASE_URL
│   └── seed-dev.ts                   # Load sample corpus data for local dev
│
├── middleware.ts                     # Clerk auth middleware (protect /app/* routes)
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── .env.example
├── .github/
│   └── workflows/
│       └── deploy.yml                # Vercel deploy (auto on push to main)
└── package.json
```

---

## 3. Database Schema

### 3.1 Corpus Tables (Loaded from Python Pipeline)

These tables are created and populated by `guru-corpus.sql.gz`. The TypeScript app reads them but never writes to them.

```sql
-- Loaded by guru-corpus.sql.gz from Python pipeline
-- guru-web treats these as read-only

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE traditions (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    description TEXT,
    color       TEXT             -- hex color for UI
);

CREATE TABLE texts (
    id          TEXT PRIMARY KEY,
    tradition   TEXT NOT NULL REFERENCES traditions(id),
    label       TEXT NOT NULL,
    translator  TEXT,
    source_url  TEXT,
    sections_format TEXT
);

CREATE TABLE chunks (
    id          TEXT PRIMARY KEY,
    text_id     TEXT NOT NULL REFERENCES texts(id),
    tradition   TEXT NOT NULL REFERENCES traditions(id),
    text_name   TEXT NOT NULL,
    section     TEXT NOT NULL,
    translator  TEXT,
    body        TEXT NOT NULL,
    token_count INTEGER,
    embedding   vector(768)       -- pgvector column, dimension matches embedding model
);

CREATE TABLE concepts (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    domain      TEXT,
    definition  TEXT
);

CREATE TABLE edges (
    source      TEXT NOT NULL,
    target      TEXT NOT NULL,
    edge_type   TEXT NOT NULL,     -- EXPRESSES | PARALLELS | CONTRASTS | DERIVES_FROM | BELONGS_TO
    tier        TEXT DEFAULT 'proposed',  -- verified | proposed | inferred
    weight      REAL DEFAULT 1.0,
    annotation  TEXT,
    PRIMARY KEY (source, target, edge_type)
);

CREATE INDEX idx_chunks_tradition ON chunks(tradition);
CREATE INDEX idx_chunks_text ON chunks(text_id);
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX idx_edges_source ON edges(source);
CREATE INDEX idx_edges_target ON edges(target);
CREATE INDEX idx_edges_type ON edges(edge_type);
```

### 3.2 App Tables (Managed by guru-web)

These tables are created by the migration scripts and managed by the TypeScript app.

```sql
-- 001_users.sql
CREATE TABLE users (
    id                 TEXT PRIMARY KEY,       -- Clerk user ID
    email              TEXT UNIQUE NOT NULL,
    tier               TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ
);
CREATE INDEX idx_users_email ON users(email);

-- 002_sessions_queries.sql
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions(user_id, updated_at DESC);

CREATE TABLE queries (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query_text      TEXT NOT NULL,
    response_text   TEXT NOT NULL,
    chunks_used     JSONB NOT NULL,
    model_used      TEXT NOT NULL,
    tier_used       TEXT NOT NULL,
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_queries_session ON queries(session_id, created_at);

-- 003_preferences.sql
CREATE TABLE user_preferences (
    user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    scope_mode  TEXT NOT NULL DEFAULT 'all',       -- all | whitelist | blacklist
    blocked_traditions TEXT[] DEFAULT '{}',
    blocked_texts      TEXT[] DEFAULT '{}',
    whitelisted_traditions TEXT[] DEFAULT '{}',
    whitelisted_texts      TEXT[] DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 004_quota.sql
CREATE TABLE quota_usage (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date        DATE NOT NULL,
    queries_used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
);
```

---

## 4. Core Library Modules

### 4.1 `lib/db.ts` — Database Connection

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows;
}

export async function one<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function exec(text: string, params?: any[]): Promise<void> {
  await pool.query(text, params);
}
```

### 4.2 `lib/types.ts` — Shared Types

```typescript
export interface Chunk {
  id: string;
  text_id: string;
  tradition: string;
  text_name: string;
  section: string;
  translator: string | null;
  body: string;
  token_count: number;
}

export interface RetrievedChunk extends Chunk {
  distance?: number;
  source: 'vector' | 'graph';
  tier?: 'verified' | 'proposed' | 'inferred';
}

export interface Citation {
  tradition: string;
  text: string;
  section: string;
  quote?: string;
  tier: 'verified' | 'proposed' | 'inferred';
}

export interface UserPreferences {
  scopeMode: 'all' | 'whitelist' | 'blacklist';
  blockedTraditions: string[];
  blockedTexts: string[];
  whitelistedTraditions: string[];
  whitelistedTexts: string[];
}

export interface User {
  id: string;
  email: string;
  tier: 'free' | 'pro';
  stripe_customer_id: string | null;
}

export interface Session {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueryRecord {
  id: string;
  query_text: string;
  response_text: string;
  chunks_used: string[];
  model_used: string;
  created_at: string;
}
```

### 4.3 `lib/retriever.ts` — Hybrid Retrieval

```typescript
import { query } from './db';
import { embed } from './embed';
import { walkGraph } from './graph';
import type { RetrievedChunk, UserPreferences } from './types';

export async function retrieve(
  queryText: string,
  prefs: UserPreferences,
  topK: number = 15
): Promise<RetrievedChunk[]> {
  const [vectorResults, graphResults] = await Promise.all([
    vectorSearch(queryText, prefs, topK * 2),
    graphSearch(queryText, prefs, topK * 2),
  ]);

  return mergeAndRerank(vectorResults, graphResults, topK);
}

async function vectorSearch(
  queryText: string,
  prefs: UserPreferences,
  limit: number
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embed(queryText);
  const filterSQL = buildFilterSQL(prefs);

  const rows = await query<RetrievedChunk>(
    `SELECT *, (embedding <=> $1::vector) AS distance, 'vector' AS source
     FROM chunks
     WHERE ${filterSQL.where}
     ORDER BY embedding <=> $1::vector
     LIMIT $${filterSQL.paramIndex}`,
    [JSON.stringify(queryEmbedding), ...filterSQL.params, limit]
  );

  return rows;
}

async function graphSearch(
  queryText: string,
  prefs: UserPreferences,
  limit: number
): Promise<RetrievedChunk[]> {
  const concepts = await extractConcepts(queryText);
  if (concepts.length === 0) return [];

  return walkGraph(concepts, prefs, limit);
}

function mergeAndRerank(
  vectorResults: RetrievedChunk[],
  graphResults: RetrievedChunk[],
  topK: number
): RetrievedChunk[] {
  // Deduplicate by chunk ID
  const seen = new Map<string, RetrievedChunk>();

  for (const chunk of vectorResults) {
    seen.set(chunk.id, chunk);
  }

  for (const chunk of graphResults) {
    if (!seen.has(chunk.id)) {
      seen.set(chunk.id, chunk);
    }
  }

  const merged = Array.from(seen.values());

  // Score by: tradition diversity, tier weight, vector distance
  const traditionCounts = new Map<string, number>();
  const scored = merged.map(chunk => {
    const count = (traditionCounts.get(chunk.tradition) ?? 0) + 1;
    traditionCounts.set(chunk.tradition, count);

    const tierWeight = chunk.tier === 'verified' ? 1.0
      : chunk.tier === 'proposed' ? 0.7 : 0.4;
    const diversityBoost = count === 1 ? 1.3 : 1.0;
    const distanceScore = chunk.distance != null ? 1 - chunk.distance : 0.5;

    return { chunk, score: distanceScore * tierWeight * diversityBoost };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(s => s.chunk);
}

async function extractConcepts(queryText: string): Promise<string[]> {
  // Phase 1: keyword match against concept labels in DB
  const words = queryText.toLowerCase().split(/\s+/);
  const rows = await query<{ id: string }>(
    `SELECT id FROM concepts WHERE
     ${words.map((_, i) => `LOWER(label) LIKE $${i + 1}`).join(' OR ')}`,
    words.map(w => `%${w}%`)
  );
  return rows.map(r => r.id);
}

function buildFilterSQL(prefs: UserPreferences) {
  const params: any[] = [];
  let paramIndex = 2; // $1 is reserved for embedding
  const conditions: string[] = [];

  if (prefs.scopeMode === 'blacklist') {
    if (prefs.blockedTraditions.length > 0) {
      conditions.push(`tradition <> ALL($${paramIndex}::text[])`);
      params.push(prefs.blockedTraditions);
      paramIndex++;
    }
    if (prefs.blockedTexts.length > 0) {
      conditions.push(`text_id <> ALL($${paramIndex}::text[])`);
      params.push(prefs.blockedTexts);
      paramIndex++;
    }
  } else if (prefs.scopeMode === 'whitelist') {
    if (prefs.whitelistedTraditions.length > 0) {
      conditions.push(`tradition = ANY($${paramIndex}::text[])`);
      params.push(prefs.whitelistedTraditions);
      paramIndex++;
    }
  }

  return {
    where: conditions.length > 0 ? conditions.join(' AND ') : 'TRUE',
    params,
    paramIndex,
  };
}
```

### 4.4 `lib/model.ts` — OpenRouter Client

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
});

const MODELS = {
  free: 'deepseek/deepseek-chat',
  pro: 'anthropic/claude-sonnet-4.6',
} as const;

export async function complete(prompt: string, tier: 'free' | 'pro'): Promise<string> {
  const response = await client.chat.completions.create({
    model: MODELS[tier],
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 2048,
  });
  return response.choices[0]?.message?.content ?? '';
}

export async function completeStream(prompt: string, tier: 'free' | 'pro') {
  return client.chat.completions.create({
    model: MODELS[tier],
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 2048,
    stream: true,
  });
}
```

### 4.5 `lib/embed.ts` — Query Embedding

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
});

export async function embed(text: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model: 'nomic-ai/nomic-embed-text-v1.5',
    input: text,
  });
  return response.data[0].embedding;
}
```

Note: the embedding model must match whatever the Python pipeline used to generate the corpus embeddings. If the Python side uses `nomic-embed-text` via Ollama, the TypeScript side must use the same model via OpenRouter (or a compatible endpoint). Dimension mismatch = broken vector search.

### 4.6 `lib/quota.ts` — Rate Limiting

```typescript
import { query, one } from './db';

const LIMITS = { free: 30, pro: 500 } as const;

export async function checkAndIncrement(
  userId: string,
  tier: 'free' | 'pro'
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const today = new Date().toISOString().split('T')[0];
  const limit = LIMITS[tier];

  // Atomic upsert + check
  const row = await one<{ queries_used: number }>(
    `INSERT INTO quota_usage (user_id, date, queries_used)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, date)
     DO UPDATE SET queries_used = quota_usage.queries_used + 1
     RETURNING queries_used`,
    [userId, today]
  );

  const used = row?.queries_used ?? 1;
  return { allowed: used <= limit, used, limit };
}
```

---

## 5. API Routes

### 5.1 `POST /api/query` — Core Query Endpoint

The main endpoint. Accepts a query string, runs hybrid retrieval, builds the prompt, calls the LLM, streams the response, and persists the result.

```typescript
// src/app/api/query/route.ts

import { requireUser } from '@/lib/auth';
import { retrieve } from '@/lib/retriever';
import { buildPrompt } from '@/lib/prompt';
import { completeStream } from '@/lib/model';
import { checkAndIncrement } from '@/lib/quota';
import { loadPreferences } from '@/lib/prefs';
import { exec } from '@/lib/db';

export async function POST(req: Request) {
  const user = await requireUser();
  const { query: queryText, sessionId } = await req.json();

  // Quota check
  const quota = await checkAndIncrement(user.id, user.tier);
  if (!quota.allowed) {
    return Response.json(
      { error: 'Daily query limit reached', used: quota.used, limit: quota.limit },
      { status: 429 }
    );
  }

  // Load preferences + retrieve + build prompt
  const prefs = await loadPreferences(user.id);
  const chunks = await retrieve(queryText, prefs);
  const prompt = buildPrompt(queryText, chunks, prefs, user.tier);

  // Stream LLM response
  const stream = await completeStream(prompt, user.tier);

  // Create a ReadableStream that also captures the full response for persistence
  let fullResponse = '';

  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? '';
        fullResponse += text;
        controller.enqueue(new TextEncoder().encode(text));
      }
      controller.close();

      // Persist after streaming completes
      await exec(
        `INSERT INTO queries (session_id, user_id, query_text, response_text, chunks_used, model_used, tier_used)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, user.id, queryText, fullResponse,
         JSON.stringify(chunks.map(c => c.id)),
         user.tier === 'pro' ? 'anthropic/claude-sonnet-4.6' : 'deepseek/deepseek-chat',
         user.tier]
      );
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
```

### 5.2 Other API Routes (Summary)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/sessions` | GET | List user's sessions (paginated) |
| `/api/sessions` | POST | Create new session |
| `/api/sessions/[id]` | GET | Get session messages |
| `/api/preferences` | GET | Load user's tradition scope |
| `/api/preferences` | PUT | Update user's tradition scope |
| `/api/checkout` | POST | Create Stripe checkout session for Pro upgrade |
| `/api/webhooks/clerk` | POST | Clerk user lifecycle events |
| `/api/webhooks/stripe` | POST | Stripe subscription events |

Each route follows the same pattern: `requireUser()` → validate input → database operation → return JSON. The webhook routes skip auth (they verify signatures instead).

---

## 6. Middleware

```typescript
// middleware.ts

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',                              // Landing page
  '/sign-in(.*)',                   // Clerk sign-in
  '/sign-up(.*)',                   // Clerk sign-up
  '/api/webhooks/(.*)',             // Webhooks (signature-verified, not session-verified)
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};
```

---

## 7. Design System

### 7.1 `styles/tokens.ts`

Extracted directly from the prototype. Every component imports from here.

```typescript
export const tokens = {
  bg: { deep: '#0a0a0f', surface: '#111118', raised: '#1a1a24', overlay: '#22222e' },
  text: { primary: '#d4cfc4', secondary: '#8a8578', muted: '#5a5650', accent: '#c4a35a', link: '#7a9ec2' },
  border: { subtle: '#2a2a34', medium: '#3a3a48', accent: '#c4a35a33' },
  tradition: {
    gnosticism: '#c2785a', kabbalah: '#7a7ac2', hermeticism: '#c4a35a',
    neoplatonism: '#5a8ac2', vedanta: '#c25a7a', buddhism: '#5ac27a',
    mysticism: '#a05ac2', sufism: '#5ac2a0', taoism: '#7ac27a',
  },
  tier: { verified: '#c4a35a', proposed: '#7a9ec2', inferred: '#5a5650' },
  font: {
    display: "'Cormorant Garamond', serif",
    mono: "'IBM Plex Mono', monospace",
  },
} as const;

export type Tradition = keyof typeof tokens.tradition;
```

### 7.2 Fonts

Loaded via `next/font/google` in the root layout, not via CSS `@import` (better performance, no FOUT):

```typescript
// src/app/layout.tsx
import { Cormorant_Garamond, IBM_Plex_Mono } from 'next/font/google';

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-display',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-mono',
});
```

---

## 8. Build Phases

### Phase 1: Foundation (2–3 days)
- [ ] Scaffold Next.js project
- [ ] Set up `lib/db.ts` with connection pool
- [ ] Write migration scripts (001–004)
- [ ] Set up local Postgres with pgvector for development
- [ ] Load sample corpus data (small subset: 2-3 traditions, ~50 chunks)
- [ ] Set up design tokens and global styles
- [ ] Create `scripts/migrate.ts`

### Phase 2: Retrieval Engine (3–5 days)
- [ ] Implement `lib/embed.ts` (query embedding via OpenRouter)
- [ ] Implement `lib/retriever.ts` (vector search + graph walk + merge/rerank)
- [ ] Implement `lib/graph.ts` (concept extraction + edge traversal)
- [ ] Implement `lib/budget.ts` (TokenBudget)
- [ ] Implement `lib/compress.ts` (extractive compression)
- [ ] Implement `lib/prompt.ts` (system prompt template + chunk formatting)
- [ ] Implement `lib/model.ts` (OpenRouter completion + streaming)
- [ ] Write tests: golden queries against sample corpus, verify citation accuracy

### Phase 3: Auth + User Management (2–3 days)
- [ ] Configure Clerk (dev application, social providers)
- [ ] Implement `middleware.ts`
- [ ] Implement `lib/auth.ts` (requireUser, requireTier)
- [ ] Build sign-in/sign-up pages (Clerk hosted components)
- [ ] Implement Clerk webhook handler (`/api/webhooks/clerk`)
- [ ] Test: sign-up → users row created → protected routes accessible

### Phase 4: API Routes (2–3 days)
- [ ] Implement `POST /api/query` (the core endpoint, with streaming)
- [ ] Implement session CRUD (`/api/sessions`, `/api/sessions/[id]`)
- [ ] Implement preferences CRUD (`/api/preferences`)
- [ ] Implement `lib/quota.ts` + quota enforcement in query route
- [ ] Test: end-to-end query flow (auth → quota → retrieve → prompt → stream → persist)

### Phase 5: Frontend Pages (5–7 days)
- [ ] Root layout (Clerk provider, fonts, nav bar component)
- [ ] Landing page (public, with sample query preview)
- [ ] Chat page (empty state, input, message rendering, streaming display)
- [ ] Citation component (tradition-colored, tier indicators)
- [ ] History page (session list with tradition badges)
- [ ] Settings page (scope panel with tradition/text toggles)
- [ ] Account page (plan cards, usage bar, account details)
- [ ] Mobile responsive pass on all pages (hamburger nav, stacked layouts, touch targets)

### Phase 6: Billing (2–3 days)
- [ ] Stripe product + price configuration (Pro plan)
- [ ] Implement `POST /api/checkout` (create Stripe checkout session)
- [ ] Implement Stripe webhook handler (`/api/webhooks/stripe`)
- [ ] Wire upgrade button on account page to checkout flow
- [ ] Test: full upgrade flow (click upgrade → Stripe checkout → webhook → tier updated → pro model used)

### Phase 7: Deploy + Launch (2–3 days)
- [ ] Set up Vercel project, connect repo
- [ ] Configure production environment variables
- [ ] Set up production Postgres (Hetzner VPS, hardened)
- [ ] Run migrations on production
- [ ] Load full corpus via `guru-corpus.sql.gz`
- [ ] Configure Clerk production application + webhook URL
- [ ] Configure Stripe production keys + webhook URL
- [ ] Smoke test all flows end-to-end on production
- [ ] Soft launch

**Estimated total: 5–8 weeks of focused solo work.**

---

## 9. GitHub Actions

### 9.1 CI

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm run test
```

### 9.2 Deploy

Vercel auto-deploys on push to `main` via their GitHub integration. No custom deploy workflow needed — Vercel's built-in GitHub app handles it.

Preview deployments are automatic for pull requests.

---

## 10. Cross-Repo Coordination

### Corpus Updates

When the Python pipeline produces a new `guru-corpus.sql.gz`:

```bash
# On developer's machine
cd guru-pipeline
python scripts/export.py

# Deploy to production
gunzip -c export/guru-corpus.sql.gz | psql $PROD_DATABASE_URL
```

The TypeScript app picks up new data on the next query. No redeploy, no restart, no cache invalidation.

### Schema Changes

If a corpus schema change is needed (e.g., adding a column to `chunks`):

1. Update the Python export script to include the new column.
2. Add a migration to `guru-web/migrations/` that ALTERs the production table (or the corpus reload handles it via DROP + CREATE).
3. Update TypeScript types and queries that read the affected table.
4. Deploy `guru-web` first (new code that handles both old and new schemas).
5. Load the new corpus.

Schema changes should be rare — the corpus schema is simple and stable.

---

## 11. Local Development

```bash
# Terminal 1: Local Postgres
docker run -d --name guru-pg \
  -e POSTGRES_DB=guru \
  -e POSTGRES_USER=guru \
  -e POSTGRES_PASSWORD=devpass \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Terminal 2: Run migrations + seed
npm run migrate
npm run seed-dev

# Terminal 3: Dev server
npm run dev
# → http://localhost:3000
```

The `seed-dev` script loads a small corpus subset (2-3 traditions, ~50 chunks with embeddings) so you can develop and test without the full corpus. It's a separate SQL file from the production corpus, committed to the repo.
