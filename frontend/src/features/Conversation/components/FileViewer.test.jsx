import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FileViewer from './FileViewer';

vi.mock('../../../lib/downloadFile', () => ({ default: vi.fn() }));

// eslint-disable-next-line import/first
import downloadFile from '../../../lib/downloadFile';

beforeEach(() => {
  downloadFile.mockReset();
});

describe('FileViewer', () => {
  it('renders filename, extension, and formatted size', () => {
    render(<FileViewer src="/api/files/abc" filename="report.pdf" size={2048} />);

    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('PDF · 2.0 KB')).toBeInTheDocument();
  });

  it('shows "Preview unavailable" for an unsupported file', () => {
    render(<FileViewer src="/api/files/abc" filename="mystery.xyz" size={100} unsupported />);

    expect(screen.getByText('Preview unavailable', { exact: false })).toBeInTheDocument();
  });

  it('Download button calls downloadFile with the src and filename, not a plain link', async () => {
    const user = userEvent.setup();
    render(<FileViewer src="/api/files/abc" filename="report.pdf" size={2048} />);

    const button = screen.getByRole('button', { name: /download/i });
    expect(button.tagName).toBe('BUTTON');

    await user.click(button);

    expect(downloadFile).toHaveBeenCalledWith('/api/files/abc', 'report.pdf');
  });
});
