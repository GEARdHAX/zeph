import { describe, it, expect, beforeEach, vi } from 'vitest';

// Regression: applyThemeToDom() (sets data-theme attribute + .dark/.light
// class) was previously only ever called from toggle() — never on initial
// load. A returning visitor whose stored preference is 'light' got
// light-mode React state (useTheme().theme === 'light') while <html> kept
// NO data-theme attribute at all. index.css's dark-mode CSS variable
// overrides are keyed on `:root:not([data-theme='light'])` — true for
// "attribute absent," not just "attribute is 'dark'" — so every
// CSS-variable-driven surface (e.g. a message bubble's bg-card background)
// silently stayed on its dark value despite the rest of the UI rendering
// as light mode. The fix: useTheme.js applies the resolved theme to the
// DOM once at module load, so importing the module itself is the thing
// under test here, not calling the hook.
describe('useTheme — applies the stored theme to the DOM on module load', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark', 'light');
    localStorage.clear();
  });

  it('sets data-theme="light" on import when localStorage has a stored light preference', async () => {
    localStorage.setItem('theme', 'light');

    await import('./useTheme');

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('sets data-theme="dark" on import when localStorage has a stored dark preference', async () => {
    localStorage.setItem('theme', 'dark');

    await import('./useTheme');

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('defaults to dark (and sets the DOM to match) when nothing is stored', async () => {
    await import('./useTheme');

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('never leaves data-theme unset after import — the exact state that caused the bug', async () => {
    localStorage.setItem('theme', 'light');

    await import('./useTheme');

    // The actual regression: this attribute must never be null/absent,
    // regardless of which theme resolves — index.css's selector treats
    // "absent" as "dark," not as "no opinion."
    expect(document.documentElement.getAttribute('data-theme')).not.toBeNull();
  });
});
