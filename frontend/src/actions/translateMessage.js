import axios from 'axios';
import Config from '../config';

// signal (optional) lets the caller cancel an in-flight translate request
// (component unmount, user navigates away, or a newer request supersedes
// this one) — axios forwards a native AbortSignal directly.
const translateMessage = (text, targetLanguage, signal) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/ai/translate`,
  data: { text, targetLanguage },
  signal,
});

export default translateMessage;
