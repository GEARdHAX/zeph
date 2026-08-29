import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BrandLogo from './BrandLogo';
import Config from '../config';

describe('BrandLogo', () => {
  it('renders as an accessible placeholder mark, not a real logo image', () => {
    render(<BrandLogo />);
    const el = screen.getByRole('img', { name: /zeph logo placeholder/i });
    expect(el.tagName).not.toBe('IMG');
  });

  it('accepts a custom className for sizing', () => {
    render(<BrandLogo className="h-4 w-4 custom-class" />);
    expect(screen.getByRole('img')).toHaveClass('custom-class');
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
