import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Sensors from './Sensors';
import { getSensorStatus, registerSensor } from '../../actions/ebpfSensors';

vi.mock('../../actions/ebpfSensors', () => ({
  getSensorStatus: vi.fn(),
  registerSensor: vi.fn(),
}));

const SENSOR = {
  sensorId: 'prod-vps-1',
  hostId: 'prod-vps-1.example.com',
  status: 'online',
  version: '0.1.0',
  lastHeartbeat: '2024-06-01T12:00:00Z',
  eventsLast24h: 42,
};

function renderPage() {
  render(
    <MemoryRouter>
      <Sensors />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getSensorStatus.mockReset();
  registerSensor.mockReset();
});

describe('Sensors viewer', () => {
  it('shows a loading state, then the empty state when there are no sensors', async () => {
    getSensorStatus.mockResolvedValue({ data: { sensors: [] } });
    renderPage();

    expect(await screen.findByText(/no sensors registered/i)).toBeInTheDocument();
  });

  it('renders the required columns for a returned sensor', async () => {
    getSensorStatus.mockResolvedValue({ data: { sensors: [SENSOR] } });
    renderPage();

    const row = (await screen.findByText('prod-vps-1')).closest('tr');
    expect(row).toHaveTextContent('prod-vps-1.example.com');
    expect(row).toHaveTextContent('online');
    expect(row).toHaveTextContent('0.1.0');
    expect(row).toHaveTextContent('42');
  });

  it('shows "Never" for a registered sensor with no heartbeat yet', async () => {
    getSensorStatus.mockResolvedValue({
      data: { sensors: [{ ...SENSOR, status: 'offline', lastHeartbeat: null, version: null }] },
    });
    renderPage();

    const row = (await screen.findByText('prod-vps-1')).closest('tr');
    expect(row).toHaveTextContent('Never');
    expect(row).toHaveTextContent('offline');
  });

  it('handles a load failure without crashing', async () => {
    getSensorStatus.mockRejectedValue(new Error('network error'));
    renderPage();

    expect(await screen.findByText(/no sensors registered/i)).toBeInTheDocument();
  });

  it('registering a sensor shows the one-time credential and refreshes the list', async () => {
    getSensorStatus.mockResolvedValue({ data: { sensors: [] } });
    registerSensor.mockResolvedValue({ data: { sensorId: 'new-1', hostId: 'host-1', credential: 'raw-secret-value' } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/no sensors registered/i);

    await user.click(screen.getByRole('button', { name: /register sensor/i }));
    await user.type(screen.getByLabelText(/sensor id/i), 'new-1');
    await user.type(screen.getByLabelText(/host id/i), 'host-1');
    await user.click(screen.getByRole('button', { name: /^register$/i }));

    expect(registerSensor).toHaveBeenCalledWith('new-1', 'host-1');
    expect(await screen.findByText('raw-secret-value')).toBeInTheDocument();
    await waitFor(() => expect(getSensorStatus).toHaveBeenCalledTimes(2));
  });

  it('shows an error message when registration fails', async () => {
    getSensorStatus.mockResolvedValue({ data: { sensors: [] } });
    registerSensor.mockRejectedValue({ response: { data: { reason: 'sensor_already_registered' } } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/no sensors registered/i);

    await user.click(screen.getByRole('button', { name: /register sensor/i }));
    await user.type(screen.getByLabelText(/sensor id/i), 'dup-1');
    await user.type(screen.getByLabelText(/host id/i), 'host-1');
    await user.click(screen.getByRole('button', { name: /^register$/i }));

    expect(await screen.findByText('sensor_already_registered')).toBeInTheDocument();
  });
});
