import { describe, expect, it } from 'vitest';
import { inferFormatFromUrl, sniffFormat, toRawUrl } from './repo-url';

describe('toRawUrl', () => {
  it('rewrites a GitHub blob URL to raw.githubusercontent.com', () => {
    expect(toRawUrl('https://github.com/acme/design/blob/main/tokens.json')).toBe(
      'https://raw.githubusercontent.com/acme/design/main/tokens.json',
    );
  });

  it('rewrites a GitHub blob URL with a nested path', () => {
    expect(toRawUrl('https://github.com/acme/design/blob/v2/src/tokens/colors.json')).toBe(
      'https://raw.githubusercontent.com/acme/design/v2/src/tokens/colors.json',
    );
  });

  it('rewrites the GitHub /raw/ page form too', () => {
    expect(toRawUrl('https://github.com/acme/design/raw/main/tokens.md')).toBe(
      'https://raw.githubusercontent.com/acme/design/main/tokens.md',
    );
  });

  it('drops the blob query string (e.g. ?plain=1)', () => {
    expect(toRawUrl('https://github.com/acme/design/blob/main/tokens.json?plain=1')).toBe(
      'https://raw.githubusercontent.com/acme/design/main/tokens.json',
    );
  });

  it('leaves an already-raw GitHub URL unchanged', () => {
    const raw = 'https://raw.githubusercontent.com/acme/design/main/tokens.json';
    expect(toRawUrl(raw)).toBe(raw);
  });

  it('rewrites a GitLab blob URL to the raw form', () => {
    expect(toRawUrl('https://gitlab.com/acme/design/-/blob/main/tokens.json')).toBe(
      'https://gitlab.com/acme/design/-/raw/main/tokens.json',
    );
  });

  it('handles nested GitLab subgroups via the /-/ delimiter', () => {
    expect(toRawUrl('https://gitlab.com/acme/team/design/-/blob/main/tokens.json')).toBe(
      'https://gitlab.com/acme/team/design/-/raw/main/tokens.json',
    );
  });

  it('returns non-GitHub/GitLab URLs unchanged', () => {
    const cdn = 'https://cdn.example.com/tokens.json';
    expect(toRawUrl(cdn)).toBe(cdn);
  });

  it('returns unparseable input unchanged', () => {
    expect(toRawUrl('not a url')).toBe('not a url');
  });

  it('does not rewrite a GitHub repo root or non-blob path', () => {
    const repo = 'https://github.com/acme/design';
    expect(toRawUrl(repo)).toBe(repo);
  });
});

describe('inferFormatFromUrl', () => {
  it('detects .json', () => {
    expect(inferFormatFromUrl('https://x.com/tokens.json')).toBe('json');
  });

  it('detects .md and .markdown', () => {
    expect(inferFormatFromUrl('https://x.com/tokens.md')).toBe('markdown');
    expect(inferFormatFromUrl('https://x.com/tokens.markdown')).toBe('markdown');
  });

  it('ignores query strings when reading the extension', () => {
    expect(inferFormatFromUrl('https://x.com/tokens.json?ref=main')).toBe('json');
  });

  it('returns undefined for unknown or missing extensions', () => {
    expect(inferFormatFromUrl('https://x.com/tokens')).toBeUndefined();
    expect(inferFormatFromUrl('https://x.com/tokens.yaml')).toBeUndefined();
  });
});

describe('sniffFormat', () => {
  it('treats content starting with { or [ as JSON', () => {
    expect(sniffFormat('  { "color": {} }')).toBe('json');
    expect(sniffFormat('[]')).toBe('json');
  });

  it('treats other content as Markdown', () => {
    expect(sniffFormat('# Colors\n- brand: #000')).toBe('markdown');
  });
});
