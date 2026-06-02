import { describe, expect, it, vi } from 'vitest';
import { fetchRepoTokens } from './fetch-tokens';

function mockFetch(body: string, init?: ResponseInit) {
  return vi.fn(async (_input: RequestInfo | URL) => new Response(body, init));
}

describe('fetchRepoTokens', () => {
  it('rewrites a GitHub blob URL to raw before fetching', async () => {
    const fetchImpl = mockFetch('{"color":{"brand":"#000"}}');
    await fetchRepoTokens('https://github.com/acme/design/blob/main/tokens.json', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/acme/design/main/tokens.json',
    );
  });

  it('parses a fetched JSON file into the token set', async () => {
    const fetchImpl = mockFetch('{"color":{"brand":{"value":"#3b82f6"}}}');
    const { tokens } = await fetchRepoTokens('https://x.com/tokens.json', fetchImpl);
    expect(tokens.color[0]).toEqual({ category: 'color', name: 'brand', value: '#3b82f6' });
  });

  it('parses a fetched Markdown file by extension', async () => {
    const fetchImpl = mockFetch('# Color\n- brand: #3b82f6');
    const { tokens } = await fetchRepoTokens('https://x.com/tokens.md', fetchImpl);
    expect(tokens.color[0].value).toBe('#3b82f6');
  });

  it('sniffs JSON content when the extension is unknown', async () => {
    const fetchImpl = mockFetch('{"radius":{"md":"6px"}}');
    const { tokens } = await fetchRepoTokens('https://x.com/tokens', fetchImpl);
    expect(tokens.radius[0].value).toBe('6px');
  });

  it('sniffs Markdown content when the extension is unknown', async () => {
    const fetchImpl = mockFetch('# Radius\n- md: 6px');
    const { tokens } = await fetchRepoTokens('https://x.com/tokens', fetchImpl);
    expect(tokens.radius[0].value).toBe('6px');
  });

  it('throws a clear error on non-OK responses, naming the public-only limit', async () => {
    const fetchImpl = mockFetch('Not Found', { status: 404, statusText: 'Not Found' });
    await expect(
      fetchRepoTokens('https://github.com/acme/private/blob/main/tokens.json', fetchImpl),
    ).rejects.toThrow(/404 Not Found.*public repositories only/s);
  });

  it('wraps network errors with the resolved URL', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(fetchRepoTokens('https://x.com/tokens.json', fetchImpl)).rejects.toThrow(
      /Could not fetch token file from https:\/\/x\.com\/tokens\.json: Failed to fetch/,
    );
  });
});
