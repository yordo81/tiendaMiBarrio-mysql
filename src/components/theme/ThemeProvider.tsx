'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  // Sincronizar el estado de React con el tema ya aplicado por el script anti-flash
  useEffect(() => {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
      setThemeState('dark');
    } else if (html.classList.contains('light')) {
      setThemeState('light');
    } else {
      const stored = localStorage.getItem('tienda-theme') as Theme | null;
      if (stored === 'light' || stored === 'dark') {
        setThemeState(stored);
      } else {
        const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
        setThemeState(prefersLight ? 'light' : 'dark');
      }
    }
  }, []);

  // Persistir los cambios de tema
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    localStorage.setItem('tienda-theme', theme);
  }, [theme]);

  const toggleTheme = () => setThemeState(prev => (prev === 'dark' ? 'light' : 'dark'));
  const setTheme = (t: Theme) => setThemeState(t);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
