import { createContext, useContext, type ReactNode } from 'react';

const ConsentRecheckContext = createContext<(() => void) | undefined>(undefined);

export function ConsentRecheckProvider({ onRecheck, children }: { onRecheck: () => void; children: ReactNode }) {
  return <ConsentRecheckContext.Provider value={onRecheck}>{children}</ConsentRecheckContext.Provider>;
}

export function useConsentRecheck(): () => void {
  const recheck = useContext(ConsentRecheckContext);
  if (!recheck) throw new Error('ConsentRecheckProvider is missing');
  return recheck;
}
