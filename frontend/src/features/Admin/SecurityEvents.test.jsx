import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SecurityEvents from './SecurityEvents';
import { listSecurityEvents, getSecurityEvent } from '../../actions/securityEvents';

vi.mock('../../actions/securityEvents', () => ({
  listSecurityEvents: vi.fn(),
  getSecurityEvent: vi.fn(),
}));

const EVENT = {
  eventId: 'evt-1',
  timestamp: '2024-06-01T12:00:00Z',
  type: 'LOGIN_FAILED',
  severity: 'medium',
  actor: { userId: 'user-1' },
  source: { ip: '1.2.3.4' },
  result: 'failure',
};

function renderPage() {
  render(
    <MemoryRouter>
      <SecurityEvents />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listSecurityEvents.mockReset();
  getSecurityEvent.mockReset();
});

describe('SecurityEvents viewer', () => {
  it('shows a loading state, then the empty state when there are no events', async () => {
    listSecurityEvents.mockResolvedValue({ data: { events: [], cursor: null } });
    renderPage();

    expect(await screen.findByText(/no security events found/i)).toBeInTheDocument();
  });

  it('renders the required columns for a returned event', async () => {
    listSecurityEvents.mockResolvedValue({ data: { events: [EVENT], cursor: null } });
    renderPage();

    const row = (await screen.findByText('user-1')).closest('tr');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('LOGIN_FAILED');
    expect(row).toHaveTextContent('medium');
    expect(row).toHaveTextContent('1.2.3.4');
    expect(row).toHaveTextContent('failure');
  });

  it('passes filter values through to the list action', async () => {
    listSecurityEvents.mockResolvedValue({ data: { events: [], cursor: null } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/no security events found/i);

    await user.selectOptions(screen.getByDisplayValue('All types'), 'LOGIN_FAILED');

    await waitFor(() => expect(listSecurityEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'LOGIN_FAILED' }),
    ));
  });

  it('enables Next only when the API returns a cursor', async () => {
    listSecurityEvents.mockResolvedValue({ data: { events: [EVENT], cursor: '2024-06-01T00:00:00Z' } });
    renderPage();
    await screen.findByText('user-1');

    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });

  it('Next disabled with no cursor', async () => {
    listSecurityEvents.mockResolvedValue({ data: { events: [EVENT], cursor: null } });
    renderPage();
    await screen.findByText('user-1');

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('clicking a row opens the detail panel with the full event', async () => {
    listSecurityEvents.mockResolvedValue({ data: { events: [EVENT], cursor: null } });
    getSecurityEvent.mockResolvedValue({ data: { event: { ...EVENT, metadata: { reason: 'bad_password' } } } });
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('user-1')).closest('tr');

    await user.click(row);

    expect(getSecurityEvent).toHaveBeenCalledWith('evt-1');
    await waitFor(() => expect(screen.getByText(/bad_password/)).toBeInTheDocument());
  });

  it('handles a load failure without crashing (shows the empty state)', async () => {
    listSecurityEvents.mockRejectedValue(new Error('network error'));
    renderPage();

    expect(await screen.findByText(/no security events found/i)).toBeInTheDocument();
  });
});

describe('SecurityEvents viewer — Zero Trust decision detail (Phase 2)', () => {
  const ZT_EVENT = {
    eventId: 'evt-zt-1',
    timestamp: '2024-06-01T12:00:00Z',
    type: 'ZERO_TRUST_STEP_UP',
    severity: 'medium',
    actor: { userId: 'user-1', sessionId: 'session-1' },
    source: { ip: '1.2.3.4', deviceId: null },
    result: 'blocked',
    metadata: {
      riskScore: 74, riskLevel: 'HIGH', policy: 'sensitive_action', reason: 'risk_above_threshold',
    },
  };

  it('shows the structured risk/decision/policy/reason summary for a Zero Trust event', async () => {
    listSecurityEvents.mockResolvedValue({ data: { events: [ZT_EVENT], cursor: null } });
    getSecurityEvent.mockResolvedValue({ data: { event: ZT_EVENT } });
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('user-1')).closest('tr');

    await user.click(row);

    expect(await screen.findByText('STEP_UP')).toBeInTheDocument();
    expect(screen.getByText('sensitive_action')).toBeInTheDocument();
    expect(screen.getByText('risk_above_threshold')).toBeInTheDocument();
    expect(screen.getByText('74 (HIGH)')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument(); // no deviceId on this event
  });

  it('does not show the Zero Trust summary block for a non-Zero-Trust event (no riskScore in metadata)', async () => {
    listSecurityEvents.mockResolvedValue({ data: { events: [EVENT], cursor: null } });
    getSecurityEvent.mockResolvedValue({ data: { event: { ...EVENT, metadata: { reason: 'bad_password' } } } });
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('user-1')).closest('tr');

    await user.click(row);

    await waitFor(() => expect(screen.getByText(/bad_password/)).toBeInTheDocument());
    expect(screen.queryByText('Decision')).not.toBeInTheDocument();
  });
});
