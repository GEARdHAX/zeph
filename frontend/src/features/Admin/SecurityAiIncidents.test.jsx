import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SecurityAiIncidents from './SecurityAiIncidents';
import { listAiIncidents, getAiIncident } from '../../actions/securityAi';

vi.mock('../../actions/securityAi', () => ({
  listAiIncidents: vi.fn(),
  getAiIncident: vi.fn(),
}));

const INCIDENT = {
  incidentId: 'incident-1',
  startedAt: '2024-06-01T12:00:00Z',
  lastSeenAt: '2024-06-01T12:05:00Z',
  severity: 'high',
  signals: ['process_anomaly', 'malicious_ip'],
  hosts: ['host-1'],
  sources: ['ebpf', 'threat_intelligence'],
  eventCount: 3,
  aiAnalysis: {
    anomalous: true, confidence: 86, summary: 'Correlated process and network anomaly with a confirmed malicious destination.', model: 'llama3.2:1b', analyzedAt: '2024-06-01T12:06:00Z',
  },
};

function renderPage() {
  render(
    <MemoryRouter>
      <SecurityAiIncidents />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listAiIncidents.mockReset();
  getAiIncident.mockReset();
});

describe('SecurityAiIncidents viewer', () => {
  it('shows the empty state when there are no incidents', async () => {
    listAiIncidents.mockResolvedValue({ data: { incidents: [] } });
    renderPage();
    expect(await screen.findByText(/no incidents found/i)).toBeInTheDocument();
  });

  it('renders the required columns for a returned incident', async () => {
    listAiIncidents.mockResolvedValue({ data: { incidents: [INCIDENT] } });
    renderPage();
    const row = (await screen.findByText('process_anomaly, malicious_ip')).closest('tr');
    expect(row).toHaveTextContent('high');
    expect(row).toHaveTextContent('3');
    expect(row).toHaveTextContent('Anomalous (86%)');
  });

  it('shows "Not yet analyzed" for an incident with no aiAnalysis yet', async () => {
    listAiIncidents.mockResolvedValue({
      data: { incidents: [{ ...INCIDENT, aiAnalysis: {} }] },
    });
    renderPage();
    const row = (await screen.findByText('process_anomaly, malicious_ip')).closest('tr');
    expect(row).toHaveTextContent('Not yet analyzed');
  });

  it('clicking a row opens the detail panel, clearly labeled as advisory AI analysis', async () => {
    listAiIncidents.mockResolvedValue({ data: { incidents: [INCIDENT] } });
    getAiIncident.mockResolvedValue({ data: { incident: INCIDENT } });
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('process_anomaly, malicious_ip')).closest('tr');

    await user.click(row);

    expect(getAiIncident).toHaveBeenCalledWith('incident-1');
    expect(await screen.findByText(/AI-Assisted Analysis \(advisory only\)/i)).toBeInTheDocument();
    // "not a security decision" appears both in the page subtitle and the
    // detail panel's own footer disclaimer — assert at least one instance
    // exists rather than assuming exactly one.
    expect(screen.getAllByText(/not a security decision/i).length).toBeGreaterThan(0);
  });

  it('shows an honest "no AI analysis available" message for an incident with no aiAnalysis.analyzedAt', async () => {
    listAiIncidents.mockResolvedValue({ data: { incidents: [INCIDENT] } });
    getAiIncident.mockResolvedValue({ data: { incident: { ...INCIDENT, aiAnalysis: {} } } });
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('process_anomaly, malicious_ip')).closest('tr');

    await user.click(row);

    expect(await screen.findByText(/no ai analysis available for this incident yet/i)).toBeInTheDocument();
  });

  it('passes the severity filter through to the list action', async () => {
    listAiIncidents.mockResolvedValue({ data: { incidents: [] } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/no incidents found/i);

    await user.selectOptions(screen.getByDisplayValue('All severities'), 'critical');

    expect(listAiIncidents).toHaveBeenLastCalledWith(expect.objectContaining({ severity: 'critical' }));
  });

  it('handles a load failure without crashing', async () => {
    listAiIncidents.mockRejectedValue(new Error('network error'));
    renderPage();
    expect(await screen.findByText(/no incidents found/i)).toBeInTheDocument();
  });
});
