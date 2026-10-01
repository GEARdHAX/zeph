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

// Runs once at module load (before React's first render) — without this,
// the DOM's data-theme attribute/.dark|.light class was only ever set
// inside toggle(), so a returning visitor whose stored preference is
// 'light' got light-mode REACT STATE (theme === 'light') while the actual
// <html> element kept no data-theme attribute at all. index.css's dark
// overrides are keyed on :root:not([data-theme='light']) — true for
// "attribute absent," not just "attribute is 'dark'" — so every CSS
// variable silently stayed on its dark default despite the UI otherwise
// rendering as if light mode were active (visible as components whose
// colors come from inline/Tailwind classes correctly going light, while
// anything relying on the underlying CSS custom properties stayed dark —
// e.g. a message bubble's background rendering black-on-black in "light
// mode"). Called eagerly here, not in a useEffect, so it runs before first
// paint and never causes a flash of the wrong theme.
applyThemeToDom(getActiveTheme());

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
