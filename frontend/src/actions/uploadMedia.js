import axios from 'axios';
import Config from '../config';

// `poster` is an optional JPEG Blob (a client-captured video frame, grabbed
// during the trim-editor step) — the backend stores it as the media's
// thumbnail without needing any server-side video-frame extraction.
const uploadMedia = (file, onProgress = () => {}, poster) => {
  const url = `${Config.url || ''}/api/upload/media`;

  const data = new FormData();
  data.append('file', file, file.name);
  if (poster) data.append('poster', poster, 'poster.jpg');

  const config = {
    onUploadProgress: onProgress,
  };

  return axios.post(url, data, config);
};

export default uploadMedia;
