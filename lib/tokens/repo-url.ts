// Pure URL helpers for the repo-URL token input. No network access here so the
// rewriting rules stay easy to test in isolation.

export type TokenFileFormat = 'json' | 'markdown';

// Rewrites human-facing GitHub/GitLab "blob" page URLs to their raw equivalent
// so a fetch returns the file rather than an HTML page. Already-raw URLs and any
// other host are returned unchanged (fetched as-is, failing gracefully later).
export function toRawUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input; // not a parseable URL; let the fetch layer surface the error
  }

  if (url.hostname === 'github.com') {
    // /{org}/{repo}/blob/{ref}/{path} -> raw.githubusercontent.com/{org}/{repo}/{ref}/{path}
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 5 && (parts[2] === 'blob' || parts[2] === 'raw')) {
      const [org, repo, , ...rest] = parts;
      return `https://raw.githubusercontent.com/${org}/${repo}/${rest.join('/')}`;
    }
    return input;
  }

  if (url.hostname === 'gitlab.com') {
    // The /-/ delimiter separates the (possibly nested-group) project path from
    // the ref+path, so a plain replace is robust to subgroups.
    if (url.pathname.includes('/-/blob/')) {
      return `${url.origin}${url.pathname.replace('/-/blob/', '/-/raw/')}${url.search}`;
    }
    return input;
  }

  return input;
}

// Infers the parser to use from the URL's file extension. Returns undefined when
// the extension is missing or unrecognized; the fetch layer then sniffs content.
export function inferFormatFromUrl(input: string): TokenFileFormat | undefined {
  let pathname = input;
  try {
    pathname = new URL(input).pathname;
  } catch {
    // use the raw string
  }
  const lower = pathname.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return undefined;
}

// Last-resort format detection from file contents when the extension is unknown.
export function sniffFormat(text: string): TokenFileFormat {
  const trimmed = text.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'markdown';
}
