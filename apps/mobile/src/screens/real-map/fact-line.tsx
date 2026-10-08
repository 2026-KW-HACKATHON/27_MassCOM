import { Text, type TextStyle } from 'react-native';

import type { CriticalFact } from '@/merchant/merchant-card-facts';

/** Critical facts on one wrapped line. A warning fragment gets a ⚠ prefix as well as the warning colour, so tone is never colour-only. */
export function FactLine({ facts, base, warning }: { facts: readonly CriticalFact[]; base: TextStyle; warning: TextStyle }) {
  if (!facts.length) return null;
  return <Text style={base}>{facts.map((fact, index) => (
    <Text key={fact.key} style={fact.tone === 'warning' ? warning : undefined}>{index ? ' · ' : ''}{fact.tone === 'warning' ? '⚠ ' : ''}{fact.text}</Text>
  ))}</Text>;
}
