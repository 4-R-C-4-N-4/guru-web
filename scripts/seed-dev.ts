/**
 * scripts/seed-dev.ts
 *
 * Load a minimal sample corpus into local Postgres for development.
 * Creates the corpus tables (traditions, texts, chunks, concepts, edges)
 * if they don't exist, then inserts a small dataset (3 traditions, ~15 chunks).
 *
 * Embeddings are zeroed — vector search won't return ranked results locally
 * unless you run real embeddings, but the schema and graph queries will work.
 *
 * Usage:
 *   npx tsx scripts/seed-dev.ts
 *   npm run seed-dev
 */

import { Pool } from 'pg';

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS traditions (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  color       TEXT
);

CREATE TABLE IF NOT EXISTS texts (
  id              TEXT PRIMARY KEY,
  tradition       TEXT NOT NULL REFERENCES traditions(id),
  label           TEXT NOT NULL,
  translator      TEXT,
  source_url      TEXT,
  sections_format TEXT
);

CREATE TABLE IF NOT EXISTS chunks (
  id          TEXT PRIMARY KEY,
  text_id     TEXT NOT NULL REFERENCES texts(id),
  tradition   TEXT NOT NULL REFERENCES traditions(id),
  text_name   TEXT NOT NULL,
  section     TEXT NOT NULL,
  translator  TEXT,
  body        TEXT NOT NULL,
  token_count INTEGER,
  embedding   vector(768)
);

CREATE TABLE IF NOT EXISTS concepts (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  domain     TEXT,
  definition TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  source      TEXT NOT NULL,
  target      TEXT NOT NULL,
  edge_type   TEXT NOT NULL,
  tier        TEXT DEFAULT 'proposed',
  weight      REAL DEFAULT 1.0,
  annotation  TEXT,
  PRIMARY KEY (source, target, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_chunks_tradition ON chunks(tradition);
CREATE INDEX IF NOT EXISTS idx_chunks_text      ON chunks(text_id);
CREATE INDEX IF NOT EXISTS idx_edges_source     ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target     ON edges(target);
CREATE INDEX IF NOT EXISTS idx_edges_type       ON edges(edge_type);
`;

const TRADITIONS = [
  { id: 'gnosticism',  label: 'Gnosticism',  color: '#c2785a', description: 'Late antique religious current emphasising direct experiential knowledge (gnosis).' },
  { id: 'hermeticism', label: 'Hermeticism', color: '#c4a35a', description: 'Greco-Egyptian esoteric tradition attributed to Hermes Trismegistus.' },
  { id: 'vedanta',     label: 'Vedanta',     color: '#c25a7a', description: 'Hindu philosophical tradition based on the Upanishads, Brahma Sutras, and Bhagavad Gita.' },
];

const TEXTS = [
  { id: 'gospel-thomas',    tradition: 'gnosticism',  label: 'Gospel of Thomas',    translator: 'Thomas O. Lambdin' },
  { id: 'apocryphon-john',  tradition: 'gnosticism',  label: 'Apocryphon of John',  translator: 'Frederick Wisse' },
  { id: 'corpus-hermeticum',tradition: 'hermeticism', label: 'Corpus Hermeticum',   translator: 'G.R.S. Mead' },
  { id: 'chandogya',        tradition: 'vedanta',     label: 'Chandogya Upanishad', translator: 'F. Max Müller' },
  { id: 'mandukya',         tradition: 'vedanta',     label: 'Mandukya Upanishad',  translator: 'Swami Gambhirananda' },
];

const CHUNKS = [
  { id: 'gt-77',  text_id: 'gospel-thomas',    tradition: 'gnosticism',  text_name: 'Gospel of Thomas',    section: 'Logion 77',    body: 'I am the light that is over all things. I am all. From me all came forth, and to me all attained.' },
  { id: 'gt-3',   text_id: 'gospel-thomas',    tradition: 'gnosticism',  text_name: 'Gospel of Thomas',    section: 'Logion 3',     body: 'If those who lead you say to you, "See, the kingdom is in the sky," then the birds of the sky will precede you. Rather, the kingdom is within you and outside you.' },
  { id: 'gt-50',  text_id: 'gospel-thomas',    tradition: 'gnosticism',  text_name: 'Gospel of Thomas',    section: 'Logion 50',    body: 'If they say to you, "Where did you come from?", say to them, "We came from the light, the place where the light came into being on its own accord."' },
  { id: 'aj-4',   text_id: 'apocryphon-john',  tradition: 'gnosticism',  text_name: 'Apocryphon of John',  section: 'Section 4',    body: 'The Monad is a monarchy with nothing above it. It is he who exists as God and Father of everything, the invisible One who is above everything.' },
  { id: 'aj-14',  text_id: 'apocryphon-john',  tradition: 'gnosticism',  text_name: 'Apocryphon of John',  section: 'Section 14',   body: 'The Demiurge is not the supreme God but an inferior being who fashioned the material world in ignorance of the true divine light above.' },
  { id: 'ch-1-6', text_id: 'corpus-hermeticum', tradition: 'hermeticism', text_name: 'Corpus Hermeticum',   section: 'Tractate I.6', body: 'The Mind of God, which is Life and Light, gave birth to a Man like himself, whom he loved as his own child. The Man, seeing his own image in the water, fell in love with it and desired to dwell there.' },
  { id: 'ch-1-9', text_id: 'corpus-hermeticum', tradition: 'hermeticism', text_name: 'Corpus Hermeticum',   section: 'Tractate I.9', body: 'Know therefore that you are yourself divine, and that the light within you is not different from the eternal Light.' },
  { id: 'ch-4-2', text_id: 'corpus-hermeticum', tradition: 'hermeticism', text_name: 'Corpus Hermeticum',   section: 'Tractate IV.2',body: 'God filled a great mixing bowl with Mind and sent it down, appointing a herald and bidding him proclaim: Immerse yourself in this bowl if you can.' },
  { id: 'cu-6-8', text_id: 'chandogya',         tradition: 'vedanta',     text_name: 'Chandogya Upanishad', section: '6.8.7',        body: 'Tat tvam asi — thou art that. The finest essence of this world — that constitutes the Atman; that is Reality; that is Atman. That thou art, Shvetaketu.' },
  { id: 'cu-3-14',text_id: 'chandogya',         tradition: 'vedanta',     text_name: 'Chandogya Upanishad', section: '3.14.1',       body: 'All this is Brahman. Let a man meditate on that visible world as beginning, ending, and breathing in it, the Brahman.' },
  { id: 'mu-1-2', text_id: 'mandukya',          tradition: 'vedanta',     text_name: 'Mandukya Upanishad',  section: 'Verse 2',      body: 'All this is certainly Brahman. This Atman is Brahman. This Atman has four quarters.' },
  { id: 'mu-1-7', text_id: 'mandukya',          tradition: 'vedanta',     text_name: 'Mandukya Upanishad',  section: 'Verse 7',      body: 'The Fourth is thought of as that which is not conscious of the internal world, nor conscious of the external world, nor conscious of both the worlds, not a mass of consciousness.' },
];

const CONCEPTS = [
  { id: 'divine-spark', label: 'Divine Spark', domain: 'soteriology', definition: 'A fragment of divine light or consciousness embedded within the human being, requiring liberation or recognition.' },
  { id: 'gnosis',       label: 'Gnosis',       domain: 'epistemology', definition: 'Direct experiential knowledge of the divine, distinct from discursive or rational knowledge.' },
  { id: 'atman',        label: 'Atman',        domain: 'metaphysics',  definition: 'The individual self or soul in Hindu philosophy, held to be identical with Brahman in Advaita Vedanta.' },
  { id: 'nous',         label: 'Nous',         domain: 'metaphysics',  definition: 'Divine Mind or Intellect; in Hermetic thought, the luminous principle within the human being.' },
];

const EDGES = [
  { source: 'divine-spark', target: 'gnosis',  edge_type: 'PARALLELS',    tier: 'verified', weight: 1.0 },
  { source: 'divine-spark', target: 'atman',   edge_type: 'PARALLELS',    tier: 'proposed', weight: 0.8 },
  { source: 'divine-spark', target: 'nous',    edge_type: 'PARALLELS',    tier: 'proposed', weight: 0.8 },
  { source: 'gnosis',       target: 'atman',   edge_type: 'PARALLELS',    tier: 'inferred', weight: 0.5 },
  { source: 'nous',         target: 'gnosis',  edge_type: 'DERIVES_FROM', tier: 'proposed', weight: 0.7 },
  { source: 'gt-77',        target: 'divine-spark', edge_type: 'EXPRESSES', tier: 'verified', weight: 1.0 },
  { source: 'ch-1-6',       target: 'divine-spark', edge_type: 'EXPRESSES', tier: 'proposed', weight: 0.8 },
  { source: 'cu-6-8',       target: 'atman',         edge_type: 'EXPRESSES', tier: 'verified', weight: 1.0 },
];

async function seed() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('Creating corpus tables…');
    await client.query(SCHEMA);

    console.log('Seeding traditions…');
    for (const t of TRADITIONS) {
      await client.query(
        `INSERT INTO traditions (id, label, description, color) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [t.id, t.label, t.description, t.color]
      );
    }

    console.log('Seeding texts…');
    for (const t of TEXTS) {
      await client.query(
        `INSERT INTO texts (id, tradition, label, translator) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [t.id, t.tradition, t.label, t.translator]
      );
    }

    console.log('Seeding chunks (embeddings zeroed)…');
    const zeroVec = JSON.stringify(Array(768).fill(0));
    for (const c of CHUNKS) {
      await client.query(
        `INSERT INTO chunks (id, text_id, tradition, text_name, section, body, token_count, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector) ON CONFLICT (id) DO NOTHING`,
        [c.id, c.text_id, c.tradition, c.text_name, c.section, c.body, c.body.split(/\s+/).length, zeroVec]
      );
    }

    console.log('Seeding concepts…');
    for (const c of CONCEPTS) {
      await client.query(
        `INSERT INTO concepts (id, label, domain, definition) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [c.id, c.label, c.domain, c.definition]
      );
    }

    console.log('Seeding edges…');
    for (const e of EDGES) {
      await client.query(
        `INSERT INTO edges (source, target, edge_type, tier, weight) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [e.source, e.target, e.edge_type, e.tier, e.weight]
      );
    }

    await client.query('COMMIT');
    console.log(`Seed complete — ${TRADITIONS.length} traditions, ${TEXTS.length} texts, ${CHUNKS.length} chunks, ${CONCEPTS.length} concepts, ${EDGES.length} edges.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
