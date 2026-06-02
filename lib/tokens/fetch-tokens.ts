import { parseJsonTokens } from './parse-json';
import { parseMarkdownTokens } from './parse-markdown';
import { inferFormatFromUrl, sniffFormat, toRawUrl } from './repo-url';
import type { ParseResult } from './types';

// Fetches a token file from a repo URL and parses it into the internal model.
//
// GitHub/GitLab blob URLs are rewritten to raw before fetching. Format is taken
// from the file extension, falling back to content sniffing. Public repos only
// in v1 — private URLs simply fail the fetch with a surfaced error.
//
// `fetchImpl` is injectable so the logic is testable without real network.
export async function fetchRepoTokens(
  inputUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParseResult> {
  const rawUrl = toRawUrl(inputUrl);

  let response: Response;
  try {
    response = await fetchImpl(rawUrl);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not fetch token file from ${rawUrl}: ${detail}`);
  }

  if (!response.ok) {
    throw new Error(
      `Could not fetch token file from ${rawUrl}: ${response.status} ${response.statusText}. ` +
        'Note: v1 supports public repositories only.',
    );
  }

  const text = await response.text();
  const format = inferFormatFromUrl(rawUrl) ?? sniffFormat(text);
  return format === 'json' ? parseJsonTokens(text) : parseMarkdownTokens(text);
}
