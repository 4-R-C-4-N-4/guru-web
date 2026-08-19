/**
 * src/__tests__/global-error.test.tsx
 *
 * todo:0141c41f — pins that src/app/global-error.tsx exists and renders
 * a visible fallback instead of a blank page when a client-side render
 * throws. Regression coverage for the missing-error-boundary bug: a
 * Turnstile exception on /sign-up used to unmount the tree with nothing
 * left in <body>.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import GlobalError from '@/app/global-error';

describe('GlobalError', () => {
  it('renders a visible fallback with a retry action instead of a blank page', () => {
    const html = renderToStaticMarkup(
      createElement(GlobalError, { error: new Error('boom'), reset: () => {} }),
    );
    expect(html).not.toBe('');
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Try again');
  });

  it('surfaces the error digest when Next attaches one', () => {
    const error = new Error('boom') as Error & { digest?: string };
    error.digest = 'abc123';
    const html = renderToStaticMarkup(
      createElement(GlobalError, { error, reset: () => {} }),
    );
    expect(html).toContain('abc123');
  });
});
