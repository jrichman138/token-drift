import type { Token } from '../tokens/types';
import type { Classification } from './types';

// Stack-aware match: the observed primary family counts as a match if it appears
// anywhere in a token's stack. Strict bias: only declare a match when the primary
// family is genuinely present in a token's stack.
export function matchFontFamily(observed: string, tokens: Token[]): Classification {
  const observed_ = parseStack(observed);
  const primary = observed_[0];
  if (!primary) {
    return { kind: 'orphan' };
  }
  const observedNames = observed_.map((f) => f.normalized);

  let bestOverlap: Token | undefined;
  let bestOverlapCount = 0;
  for (const token of tokens) {
    const tokenNames = parseStack(String(token.value)).map((f) => f.normalized);
    if (tokenNames.includes(primary.normalized)) {
      return { kind: 'match', token };
    }
    const overlap = observedNames.filter((name) => tokenNames.includes(name)).length;
    if (overlap > bestOverlapCount) {
      bestOverlapCount = overlap;
      bestOverlap = token;
    }
  }

  const suggestion = bestOverlap ?? tokens[0];
  return suggestion
    ? { kind: 'orphan', token: suggestion, deltaLabel: `uses "${primary.display}"` }
    : { kind: 'orphan' };
}

interface Family {
  normalized: string;
  display: string;
}

function parseStack(value: string): Family[] {
  return value
    .split(',')
    .map((raw) => {
      const display = raw.trim().replace(/^["']|["']$/g, '').trim();
      return { normalized: display.toLowerCase(), display };
    })
    .filter((f) => f.normalized !== '');
}
