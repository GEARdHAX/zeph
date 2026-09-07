import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MessageContent from './MessageContent';

describe('MessageContent', () => {
  it('renders null when content is empty', () => {
    const { container } = render(<MessageContent content="" isMine={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders plain text and inline tokens safely', () => {
    render(<MessageContent content="Hello **bold** and `code`" isMine={false} />);
    expect(screen.getByText(/Hello/)).toBeInTheDocument();
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('code')).toBeInTheDocument();
  });

  it('renders fenced code blocks with language and copy button', () => {
    const codeContent = '```javascript\nconst x = 42;\n```';
    render(<MessageContent content={codeContent} isMine={false} />);
    expect(screen.getByText(/javascript/i)).toBeInTheDocument();
    expect(screen.getByText('const x = 42;')).toBeInTheDocument();
    expect(screen.getByTitle('Copy code')).toBeInTheDocument();
  });

  it('renders tables with headers and rows', () => {
    const tableText = '| Header 1 | Header 2 |\n|---|---|\n| Cell 1 | Cell 2 |';
    render(<MessageContent content={tableText} isMine={false} />);
    expect(screen.getByText('Header 1')).toBeInTheDocument();
    expect(screen.getByText('Header 2')).toBeInTheDocument();
    expect(screen.getByText('Cell 1')).toBeInTheDocument();
    expect(screen.getByText('Cell 2')).toBeInTheDocument();
  });

  it('renders headers with proper tags', () => {
    render(<MessageContent content="## Section Title" isMine={false} />);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Section Title');
  });

  it('renders blockquotes', () => {
    render(<MessageContent content="> Quoted message" isMine={false} />);
    expect(screen.getByText('Quoted message')).toBeInTheDocument();
  });

  it('renders mentions and calls onMentionClick when clicked', () => {
    const onMentionClick = vi.fn();
    render(<MessageContent content="Hey @alice check this out" isMine={false} onMentionClick={onMentionClick} />);
    const mentionBtn = screen.getByRole('button', { name: '@alice' });
    expect(mentionBtn).toBeInTheDocument();
    fireEvent.click(mentionBtn);
    expect(onMentionClick).toHaveBeenCalledWith('alice');
  });

  it('collapses very long messages and expands when Show more is clicked', () => {
    const longText = 'Paragraph line.\n'.repeat(60);
    render(<MessageContent content={longText} isMine={false} />);
    const showMoreBtn = screen.getByRole('button', { name: /Show more/i });
    expect(showMoreBtn).toBeInTheDocument();

    fireEvent.click(showMoreBtn);
    expect(screen.getByRole('button', { name: /Show less/i })).toBeInTheDocument();
  });
});
