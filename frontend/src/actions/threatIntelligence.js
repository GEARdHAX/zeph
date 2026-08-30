import axios from 'axios';
import Config from '../config';

export const listThreatIndicators = (params = {}) => axios({
  method: 'get',
  url: `${Config.url || ''}/api/security/threat-intelligence`,
  params,
});

export const getThreatIndicator = (indicator) => axios({
  method: 'get',
  url: `${Config.url || ''}/api/security/threat-intelligence/${encodeURIComponent(indicator)}`,
});

export const getThreatIntelStatus = () => axios({
  method: 'get',
  url: `${Config.url || ''}/api/security/threat-intelligence/status`,
});
