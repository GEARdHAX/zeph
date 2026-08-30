import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ThreatIntelligence from './ThreatIntelligence';
import {
  listThreatIndicators, getThreatIndicator, getThreatIntelStatus,
} from '../../actions/threatIntelligence';

vi.mock('../../actions/threatIntelligence', () => ({
  listThreatIndicators: vi.fn(),
  getThreatIndicator: vi.fn(),
  getThreatIntelStatus: vi.fn(),
}));

const INDICATOR = {
  normalizedIndicator: '203.0.113.10',
  indicator: '203.0.113.10',
  type: 'IP',
  severity: 'high',
  confidence: 91,
  source: 'abuseipdb',
  lastSeen: '2024-06-01T12:00:00Z',
  status: 'MALICIOUS',
};

const STATUS = {
  provider: 'abuseipdb', enabled: true, circuitState: 'CLOSED', dailyBudget: 800, usedToday: 12, remainingToday: 788, redisConfigured: true,
};

function renderPage() {
  render(
    <MemoryRouter>
      <ThreatIntelligence />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listThreatIndicators.mockReset();
  getThreatIndicator.mockReset();
  getThreatIntelStatus.mockReset();
  getThreatIntelStatus.mockResolvedValue({ data: STATUS });
});

describe('ThreatIntelligence viewer', () => {
  it('shows the provider status card', async () => {
    listThreatIndicators.mockResolvedValue({ data: { indicators: [], cursor: null } });
    renderPage();

    expect(await screen.findByText('abuseipdb')).toBeInTheDocument();
    expect(screen.getByText('CLOSED')).toBeInTheDocument();
    expect(screen.getByText('12 / 800')).toBeInTheDocument();
  });

  it('shows a loading state, then the empty state when there are no indicators', async () => {
    listThreatIndicators.mockResolvedValue({ data: { indicators: [], cursor: null } });
    renderPage();

    expect(await screen.findByText(/no indicators found/i)).toBeInTheDocument();
  });

  it('renders the required columns for a returned indicator', async () => {
    listThreatIndicators.mockResolvedValue({ data: { indicators: [INDICATOR], cursor: null } });
    renderPage();

    const row = (await screen.findByText('203.0.113.10')).closest('tr');
    expect(row).toHaveTextContent('IP');
    expect(row).toHaveTextContent('high');
    expect(row).toHaveTextContent('91');
    expect(row).toHaveTextContent('abuseipdb');
    expect(row).toHaveTextContent('MALICIOUS');
  });

  it('passes filter values through to the list action', async () => {
    listThreatIndicators.mockResolvedValue({ data: { indicators: [], cursor: null } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/no indicators found/i);

    await user.selectOptions(screen.getByDisplayValue('All types'), 'DOMAIN');

    await waitFor(() => expect(listThreatIndicators).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'DOMAIN' }),
    ));
  });

  it('clicking a row opens the detail panel with the full indicator', async () => {
    listThreatIndicators.mockResolvedValue({ data: { indicators: [INDICATOR], cursor: null } });
    getThreatIndicator.mockResolvedValue({ data: { indicator: { ...INDICATOR, metadata: { countryCode: 'US' } } } });
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('203.0.113.10')).closest('tr');

    await user.click(row);

    expect(getThreatIndicator).toHaveBeenCalledWith('203.0.113.10');
    await waitFor(() => expect(screen.getByText(/countryCode/)).toBeInTheDocument());
  });

  it('handles a load failure without crashing', async () => {
    listThreatIndicators.mockRejectedValue(new Error('network error'));
    renderPage();

    expect(await screen.findByText(/no indicators found/i)).toBeInTheDocument();
  });

  it('handles a status load failure gracefully (no crash, status card just does not render)', async () => {
    getThreatIntelStatus.mockRejectedValue(new Error('network error'));
    listThreatIndicators.mockResolvedValue({ data: { indicators: [], cursor: null } });
    renderPage();

    expect(await screen.findByText(/no indicators found/i)).toBeInTheDocument();
    expect(screen.queryByText('abuseipdb')).not.toBeInTheDocument();
  });
});
