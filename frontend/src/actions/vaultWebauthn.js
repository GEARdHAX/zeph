import axios from 'axios';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import Config from '../config';

const post = (path, data, vaultToken) => axios({
  method: 'post',
  url: `${Config.url || ''}${path}`,
  data,
  headers: vaultToken ? { 'X-Vault-Token': vaultToken } : undefined,
});

// Registers a new passkey for the Private Vault. vaultToken is required
// whenever a vault secret already exists (server enforces this); omit it on
// first-ever setup.
export const registerVaultPasskey = async (vaultToken) => {
  const optionsRes = await post('/api/vault/webauthn/register/options', {}, vaultToken);
  const response = await startRegistration({ optionsJSON: optionsRes.data });
  return post('/api/vault/webauthn/register/verify', { response: JSON.stringify(response) }, vaultToken);
};

// Unlocks the vault via an existing passkey — returns { vaultToken } on success.
export const unlockVaultWithPasskey = async () => {
  const optionsRes = await axios({
    method: 'post',
    url: `${Config.url || ''}/api/vault/webauthn/auth/options`,
  });
  const response = await startAuthentication({ optionsJSON: optionsRes.data });
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/vault/webauthn/auth/verify`,
    data: { response: JSON.stringify(response) },
  });
};
