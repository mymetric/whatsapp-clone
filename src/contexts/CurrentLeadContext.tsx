import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface CurrentLead {
  id: string;
  name: string;
}

interface CurrentLeadContextType {
  currentLead: CurrentLead | null;
  setCurrentLead: (lead: CurrentLead | null) => void;
}

const CurrentLeadContext = createContext<CurrentLeadContextType>({
  currentLead: null,
  setCurrentLead: () => {},
});

export const CurrentLeadProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentLead, setCurrentLeadState] = useState<CurrentLead | null>(null);

  const setCurrentLead = useCallback((lead: CurrentLead | null) => {
    setCurrentLeadState(lead);
  }, []);

  return (
    <CurrentLeadContext.Provider value={{ currentLead, setCurrentLead }}>
      {children}
    </CurrentLeadContext.Provider>
  );
};

export const useCurrentLead = () => useContext(CurrentLeadContext);
