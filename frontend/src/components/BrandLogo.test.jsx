import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { setGlobal } from 'reactn';
import BrandLogo from './BrandLogo';
import Config from '../config';

beforeEach(async () => {
  await setGlobal({ theme: 'dark' });
  document.documentElement.classList.remove('light');
  document.documentElement.classList.add('dark');
  document.documentElement.setAttribute('data-theme', 'dark');
});

describe('BrandLogo', () => {
  it('renders with an accessible img role and label', () => {
    render(<BrandLogo />);
    const el = screen.getByRole('img', { name: /zeph/i });
    expect(el).toBeInTheDocument();
  });

  it('accepts a custom className for sizing', () => {
    render(<BrandLogo className="h-4 w-4 custom-class" />);
    expect(screen.getByRole('img')).toHaveClass('custom-class');
  });

  it('renders an img element with brand assets', () => {
    const { container } = render(<BrandLogo variant="lockup" />);
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img.src).toBeTruthy();
  });

  it('switches between dark and light logo variants based on active theme', async () => {
    const { rerender } = render(<BrandLogo variant="auto" />);
    const darkImg = screen.getByRole('img');
    expect(darkImg.src).toContain('dark-bg-logo');

    // Switch to light theme
    await act(async () => {
      await setGlobal({ theme: 'light' });
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      document.documentElement.setAttribute('data-theme', 'light');
    });

    rerender(<BrandLogo variant="auto" />);
    const lightImg = screen.getByRole('img');
    expect(lightImg.src).toContain('white-bg-logo');
  });

  it('forces dark surface variant when variant="dark"', () => {
    render(<BrandLogo variant="dark" />);
    const img = screen.getByRole('img');
    expect(img.src).toContain('dark-bg-logo');
  });

  it('forces light surface variant when variant="light"', () => {
    render(<BrandLogo variant="light" />);
    const img = screen.getByRole('img');
    expect(img.src).toContain('white-bg-logo');
  });
});

describe('brand wordmark (Config.wordmark)', () => {
  it('is exactly "zeph." — lowercase, period included, no double period', () => {
    expect(Config.wordmark).toBe('zeph.');
    expect(Config.wordmark).not.toBe('Zeph.');
    expect(Config.wordmark).not.toBe('ZEPH.');
    expect(Config.wordmark).not.toMatch(/\.\./);
  });

  it('brand/appName default fallbacks also resolve to the "zeph." wordmark', () => {
    expect(Config.brand).toBe('zeph.');
    expect(Config.appName).toBe('zeph.');
  });

  it('shortName is the no-period variant, for mid-sentence use', () => {
    expect(Config.shortName).toBe('zeph');
  });
});
