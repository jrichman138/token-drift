// Pure selector-resolution logic, decoupled from the DOM so it can be tested.
// `query` returns the elements a selector matches (e.g. document.querySelectorAll
// wrapped to an array); locate.ts only cares about counts and which selectors
// found nothing.

export interface LocateResult<E> {
  // Every element matched across all selectors, de-duplicated, first-seen order.
  found: E[];
  // Selectors that matched nothing — useful for telling the user the page moved.
  missing: string[];
}

export type QueryFn<E> = (selector: string) => Iterable<E>;

export function resolveSelectors<E>(selectors: string[], query: QueryFn<E>): LocateResult<E> {
  const found: E[] = [];
  const seen = new Set<E>();
  const missing: string[] = [];

  for (const selector of selectors) {
    let matchedAny = false;
    let matches: Iterable<E>;
    try {
      matches = query(selector);
    } catch {
      // Malformed selector — treat as missing rather than throwing.
      missing.push(selector);
      continue;
    }
    for (const el of matches) {
      matchedAny = true;
      if (!seen.has(el)) {
        seen.add(el);
        found.push(el);
      }
    }
    if (!matchedAny) missing.push(selector);
  }

  return { found, missing };
}
