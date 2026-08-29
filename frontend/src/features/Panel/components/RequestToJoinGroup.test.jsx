import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RequestToJoinGroup from './RequestToJoinGroup';

vi.mock('../../../actions/invites', () => ({ requestToJoinGroup: vi.fn() }));
// eslint-disable-next-line import/first
import { requestToJoinGroup } from '../../../actions/invites';

beforeEach(() => {
  requestToJoinGroup.mockReset();
});

describe('RequestToJoinGroup', () => {
  it('sends a request with a bare group id', async () => {
    requestToJoinGroup.mockResolvedValue({ data: { status: 'pending' } });
    const onClose = vi.fn();
    const userEv = userEvent.setup();
    render(<RequestToJoinGroup onClose={onClose} />);

    await userEv.type(screen.getByLabelText(/group id/i), '64f1a2b3c4d5e6f7a8b9c0d1');
    await userEv.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(requestToJoinGroup).toHaveBeenCalledWith('64f1a2b3c4d5e6f7a8b9c0d1'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('extracts a group id from a pasted URL', async () => {
    requestToJoinGroup.mockResolvedValue({ data: { status: 'pending' } });
    const userEv = userEvent.setup();
    render(<RequestToJoinGroup onClose={() => {}} />);

    await userEv.type(screen.getByLabelText(/group id/i), 'https://zeph.example/room/64f1a2b3c4d5e6f7a8b9c0d1');
    await userEv.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(requestToJoinGroup).toHaveBeenCalledWith('64f1a2b3c4d5e6f7a8b9c0d1'));
  });

  it('shows an error and does not call the API for an unparseable id', async () => {
    const userEv = userEvent.setup();
    render(<RequestToJoinGroup onClose={() => {}} />);

    await userEv.type(screen.getByLabelText(/group id/i), 'not-an-id');
    await userEv.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText(/enter a valid group id/i)).toBeInTheDocument();
    expect(requestToJoinGroup).not.toHaveBeenCalled();
  });

  it('shows a specific message for an already-pending request', async () => {
    requestToJoinGroup.mockRejectedValue({ response: { data: { reason: 'ALREADY_REQUESTED' } } });
    const userEv = userEvent.setup();
    render(<RequestToJoinGroup onClose={() => {}} />);

    await userEv.type(screen.getByLabelText(/group id/i), '64f1a2b3c4d5e6f7a8b9c0d1');
    await userEv.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText(/already have a pending request/i)).toBeInTheDocument();
  });
});
