import axios from 'axios';
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
import Config from '../config';

const url = (path) => `${Config.url || ''}${path}`;

export const passkeySupported = () => browserSupportsWebAuthn();
export const platformPasskeyAvailable = () => platformAuthenticatorIsAvailable().catch(() => false);

// --- Account passkey management (authenticated) ---

export const listPasskeys = () => axios({ method: 'get', url: url('/api/passkey/list') });

export const registerPasskey = async (label) => {
  const options = await axios({ method: 'post', url: url('/api/passkey/register/options') });
  const response = await startRegistration({ optionsJSON: options.data });
  return axios({
    method: 'post',
    url: url('/api/passkey/register/verify'),
    data: { response: JSON.stringify(response), label: label || '' },
  });
};

export const deletePasskey = (id) => axios({ method: 'post', url: url(`/api/passkey/${id}/delete`) });

// --- Passwordless login (public) ---

// email is optional — omit it for usernameless (discoverable) sign-in: the
// browser offers every passkey saved for this site and the server resolves
// the account from the one the user picks.
export const loginWithPasskey = async (email) => {
  const options = await axios({
    method: 'post',
    url: url('/api/passkey/login/options'),
    data: email ? { email } : {},
  });
  const { flowId, ...optionsJSON } = options.data;
  const response = await startAuthentication({ optionsJSON });
  return axios({
    method: 'post',
    url: url('/api/passkey/login/verify'),
    data: { response: JSON.stringify(response), flowId },
  });
};
