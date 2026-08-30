import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NetworkIntelligence from './NetworkIntelligence';
import { getNetworkSummary } from '../../actions/networkIntel';

vi.mock('../../actions/networkIntel', () => ({
  getNetworkSummary: vi.fn(),
}));

const SUMMARY = {
  windowMs: 86400000,
  countsByType: { PORT_SCAN_ANOMALY: 2, THREAT_INTEL_NETWORK_MATCH: 1 },
  topSuspiciousDestinations: [
    { destinationIp: '198.51.100.66', count: 3, lastSeen: '2024-06-01T12:00:00Z' },
  ],
  recentAlerts: [
    {
      eventId: 'evt-1', type: 'PORT_SCAN_ANOMALY', severity: 'high', timestamp: '2024-06-01T12:00:00Z', metadata: { sensorId: 'sensor-1' },
    },
  ],
};

function renderPage() {
  render(
    <MemoryRouter>
      <NetworkIntelligence />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getNetworkSummary.mockReset();
});

describe('NetworkIntelligence viewer', () => {
  it('shows the empty state when there are no alerts', async () => {
    getNetworkSummary.mockResolvedValue({ data: { countsByType: {}, topSuspiciousDestinations: [], recentAlerts: [] } });
    renderPage();

    expect(await screen.findByText(/no network anomalies in the last 24 hours/i)).toBeInTheDocument();
    expect(screen.getByText(/no suspicious destinations/i)).toBeInTheDocument();
    expect(screen.getByText(/no recent alerts/i)).toBeInTheDocument();
  });

  it('renders counts by type, top suspicious destinations, and recent alerts', async () => {
    getNetworkSummary.mockResolvedValue({ data: SUMMARY });
    renderPage();

    expect(await screen.findAllByText('PORT_SCAN_ANOMALY')).toHaveLength(2); // appears in both the counts-by-type card and the recent-alerts row
    expect(screen.getByText('198.51.100.66')).toBeInTheDocument();
    expect(screen.getByText('sensor-1')).toBeInTheDocument();
  });

  it('handles a load failure without crashing', async () => {
    getNetworkSummary.mockRejectedValue(new Error('network error'));
    renderPage();

    expect(await screen.findByText(/unable to load network intelligence summary/i)).toBeInTheDocument();
  });
});
