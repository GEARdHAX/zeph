import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ForgotPassword from './index';
import sendCodeAction from '../../actions/sendCode';
import changePasswordAction from '../../actions/changePassword';

vi.mock('../../actions/sendCode', () => ({ default: vi.fn(() => Promise.resolve({})) }));
vi.mock('../../actions/changePassword', () => ({ default: vi.fn(() => Promise.resolve({})) }));

function renderForgotPassword() {
  render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>,
  );
}

describe('ForgotPassword', () => {
  it('renders without crashing (regression: previously imported a deleted background.jpg asset)', () => {
    expect(() => renderForgotPassword()).not.toThrow();
  });

  it('shows the email step by default', () => {
    renderForgotPassword();
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send code/i })).toBeInTheDocument();
  });

  it('sends the code and advances to the verification step', async () => {
    const user = userEvent.setup();
    renderForgotPassword();

    await user.type(screen.getByPlaceholderText('Email'), 'me@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));

    expect(sendCodeAction).toHaveBeenCalledWith('me@example.com');
    expect(await screen.findByPlaceholderText('Verification code')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('New password')).toBeInTheDocument();
  });

  it('submits the verification code and new password to change the password', async () => {
    const user = userEvent.setup();
    renderForgotPassword();

    await user.type(screen.getByPlaceholderText('Email'), 'me@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    await screen.findByPlaceholderText('Verification code');

    await user.type(screen.getByPlaceholderText('Verification code'), '123456');
    await user.type(screen.getByPlaceholderText('New password'), 'newpassword123');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(changePasswordAction).toHaveBeenCalledWith('me@example.com', '123456', 'newpassword123');
  });

  it('shows a validation error without crashing when sendCode fails', async () => {
    sendCodeAction.mockRejectedValueOnce({ response: { data: { generic: 'No account with that email.' } } });
    const user = userEvent.setup();
    renderForgotPassword();

    await user.type(screen.getByPlaceholderText('Email'), 'nope@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));

    expect(await screen.findByText('No account with that email.')).toBeInTheDocument();
    // Stays on the email step — sendCode never resolved, so `sent` never flips.
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
  });

  it('links back to /login', () => {
    renderForgotPassword();
    expect(screen.getByRole('link', { name: /back to log in/i })).toHaveAttribute('href', '/login');
  });
});
