import React, { createContext, useContext } from 'react';

export interface TicketAiContextValue {
  projectSlug: string;
}

const TicketAiContext = createContext<TicketAiContextValue | null>(null);

export const TicketAiProvider: React.FC<React.PropsWithChildren<TicketAiContextValue>> = ({
  projectSlug,
  children,
}) => (
  <TicketAiContext.Provider value={{ projectSlug }}>
    {children}
  </TicketAiContext.Provider>
);

export function useTicketAiContext(): TicketAiContextValue | null {
  return useContext(TicketAiContext);
}
