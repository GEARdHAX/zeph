import axios from 'axios';
import Config from '../config';

export const listAiIncidents = (params = {}) => axios({
  method: 'get',
  url: `${Config.url || ''}/api/security/ai/incidents`,
  params,
});

export const getAiIncident = (incidentId) => axios({
  method: 'get',
  url: `${Config.url || ''}/api/security/ai/incidents/${incidentId}`,
});
