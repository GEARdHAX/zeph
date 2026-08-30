import axios from 'axios';
import Config from '../config';

export const getSensorStatus = () => axios({
  method: 'get',
  url: `${Config.url || ''}/api/security/sensor/status`,
});

export const registerSensor = (sensorId, hostId) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/security/sensor/register`,
  data: { sensorId, hostId },
});
