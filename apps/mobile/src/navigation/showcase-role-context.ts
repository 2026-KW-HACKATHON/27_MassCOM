import { createContext } from 'react';

/** Returns the showcase app to its existing role chooser without changing the signed-in account. */
export const ShowcaseRoleReturnContext = createContext<(() => void) | undefined>(undefined);
