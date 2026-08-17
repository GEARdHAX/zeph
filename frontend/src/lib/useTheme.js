import { useGlobal } from 'reactn';

const useTheme = () => {
  const [theme, setTheme] = useGlobal('theme');

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    setTheme(next);
  };

  return { theme: theme || 'light', toggle };
};

export default useTheme;
