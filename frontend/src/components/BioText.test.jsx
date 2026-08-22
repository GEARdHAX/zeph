import {
  describe, it, expect, vi,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BioText from './BioText';

describe('BioText', () => {
  it('renders nothing for an empty bio', () => {
    const { container } = render(<BioText text="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders **bold** as a real <strong> element', () => {
    render(<BioText text="**bold**" />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('renders a link with target=_blank and rel=noopener noreferrer nofollow', () => {
    render(<BioText text="[site](https://example.com)" />);
    const link = screen.getByRole('link', { name: 'site' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('never uses dangerouslySetInnerHTML — a literal <script> tag in text renders as inert visible text', () => {
    render(<BioText text="<script>alert(1)</script>" />);
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('script')).not.toBeInTheDocument();
  });

  it('renders a mention as a disabled, non-clickable span-like button when no onMentionClick is given', () => {
    render(<BioText text="@alice" />);
    const mention = screen.getByText('@alice');
    expect(mention).toBeDisabled();
  });

  it('calls onMentionClick with the username when a mention is clicked', async () => {
    const user = userEvent.setup();
    const onMentionClick = vi.fn();
    render(<BioText text="hi @alice" onMentionClick={onMentionClick} />);

    await user.click(screen.getByText('@alice'));
    expect(onMentionClick).toHaveBeenCalledWith('alice');
  });

  it('renders a hashtag as styled text', () => {
    render(<BioText text="#chitcx" />);
    expect(screen.getByText('#chitcx')).toBeInTheDocument();
  });

  it('renders inline code verbatim, with no nested formatting interpreted', () => {
    render(<BioText text="`**not bold**`" />);
    expect(screen.getByText('**not bold**').tagName).toBe('CODE');
  });

  it('renders a line break for a newline', () => {
    const { container } = render(<BioText text={'line one\nline two'} />);
    expect(container.querySelectorAll('br')).toHaveLength(1);
  });
});
