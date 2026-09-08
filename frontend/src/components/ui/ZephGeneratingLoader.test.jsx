import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ZephGeneratingLoader } from './ZephGeneratingLoader';

describe('ZephGeneratingLoader', () => {
  it('renders default text "Generating"', () => {
    render(<ZephGeneratingLoader />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Generating');
    // Each letter of "Generating" is rendered in a span
    const letters = 'Generating'.split('');
    letters.forEach((char) => {
      expect(screen.getAllByText(char).length).toBeGreaterThan(0);
    });
  });

  it('renders custom text and subtext correctly', () => {
    render(<ZephGeneratingLoader text="Summarizing" subtext="Zeph AI is analyzing messages..." />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Summarizing — Zeph AI is analyzing messages...');
    expect(screen.getByText('Zeph AI is analyzing messages...')).toBeInTheDocument();
  });

  it('handles spaces in text gracefully', () => {
    render(<ZephGeneratingLoader text="Drafting Reply" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Drafting Reply');
  });

  it('scales to custom size', () => {
    const { container } = render(<ZephGeneratingLoader size={120} />);
    const portal = container.querySelector('.rounded-full');
    expect(portal).toHaveStyle({ width: '120px', height: '120px' });
  });
});
