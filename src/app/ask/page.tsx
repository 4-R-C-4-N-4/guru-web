/**
 * src/app/ask/page.tsx
 *
 * Public anonymous entry point (todo:f138c9ad): "Ask Guru anything." A
 * signed-out visitor asks one free question and sees the real answer with
 * citations before any signup wall. Top of the conversion funnel.
 */

import type { Metadata } from 'next';
import AskView from '@/components/ask-view';

export const metadata: Metadata = {
  title: 'Ask Guru — One Free Question',
  description:
    'Ask a question across the world’s esoteric traditions and get a sourced, cited answer from Guru — no account required for your first question.',
  alternates: { canonical: '/ask' },
};

export default function AskPage() {
  return <AskView />;
}
