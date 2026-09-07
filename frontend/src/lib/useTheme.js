import { useGlobal } from 'reactn';

const getActiveTheme = () => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') return stored;
    if (document.documentElement.classList.contains('light')) return 'light';
    if (document.documentElement.classList.contains('dark')) return 'dark';
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
  }
  return 'dark';
};

const applyThemeToDom = (targetTheme) => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', targetTheme);
  if (targetTheme === 'dark') {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  } else {
    document.documentElement.classList.add('light');
    document.documentElement.classList.remove('dark');
  }
};

const useTheme = () => {
  const [globalTheme, setGlobalTheme] = useGlobal('theme');
  const theme = globalTheme || getActiveTheme();

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyThemeToDom(next);
    setGlobalTheme(next);
  };

  return { theme, toggle };
};

export default useTheme;
export { getActiveTheme, applyThemeToDom };
