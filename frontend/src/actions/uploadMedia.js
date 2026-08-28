import axios from 'axios';
import Config from '../config';
import getInfo from './getInfo';

// Cached per page-load (not per-upload) — directUploadEnabled reflects a
// deploy-time config choice (is R2 configured on the backend), never
// changes mid-session, so re-fetching /api/info before every single file
// send would be a wasted round trip. null means "not fetched yet".
let directUploadEnabledCache = null;
const isDirectUploadEnabled = async () => {
  if (directUploadEnabledCache === null) {
    directUploadEnabledCache = await getInfo()
      .then((res) => !!res.data.directUploadEnabled)
      .catch(() => false);
  }
  return directUploadEnabledCache;
};

// Original proxy-through-Node flow — client posts the raw file, Node
// validates/stores/thumbnails it before responding. Kept as the fallback
// for any deployment without R2 configured (local-disk mode has no
// equivalent "browser uploads straight to disk" trick). See DECISIONS.md.
const uploadViaProxy = (file, onProgress, poster) => {
  const url = `${Config.url || ''}/api/upload/media`;
  const data = new FormData();
  data.append('file', file, file.name);
  if (poster) data.append('poster', poster, 'poster.jpg');
  return axios.post(url, data, { onUploadProgress: onProgress }).then((res) => res.data);
};

// Direct-to-R2 flow: presign -> PUT straight to R2 (bypasses this Node
// process entirely for the actual bytes) -> tell the server to validate/
// finalize it. See backend/src/routes/upload-media-presign.js and
// upload-media-complete.js for why validation only happens in the last
// step (the server never sees the bytes until then).
const uploadViaPresignedUrl = async (file, onProgress, poster) => {
  const presignUrl = `${Config.url || ''}/api/upload/media/presign`;
  const presignRes = await axios.post(presignUrl, {
    filename: file.name, size: file.size, poster: poster ? 'true' : undefined,
  });
  const {
    mediaId, uploadUrl, posterUploadUrl, posterStorageKey,
  } = presignRes.data;

  // Plain XHR (not axios) for the actual R2 PUT — onUploadProgress needs to
  // track this request specifically, and axios.put's own progress hook
  // works the same way, but a bare fetch() has no upload-progress event at
  // all, so this stays on axios for parity with the proxy flow's progress bar.
  await axios.put(uploadUrl, file, {
    headers: { 'Content-Type': file.type },
    onUploadProgress: onProgress,
  });

  if (poster && posterUploadUrl) {
    await axios.put(posterUploadUrl, poster, { headers: { 'Content-Type': 'image/jpeg' } });
  }

  const completeUrl = `${Config.url || ''}/api/upload/media/${mediaId}/complete`;
  const completeRes = await axios.post(completeUrl, {
    posterStorageKey: poster ? posterStorageKey : undefined,
  });
  return completeRes.data;
};

// `poster` is an optional JPEG Blob (a client-captured video frame, grabbed
// during the trim-editor step) — the backend stores it as the media's
// thumbnail without needing any server-side video-frame extraction.
// Returns { media } either way, matching the original proxy-only response
// shape — BottomBar.jsx's single call site never needs to know which path ran.
const uploadMedia = async (file, onProgress = () => {}, poster) => {
  const directUploadEnabled = await isDirectUploadEnabled();
  const data = directUploadEnabled
    ? await uploadViaPresignedUrl(file, onProgress, poster)
    : await uploadViaProxy(file, onProgress, poster);
  return { data };
};

export default uploadMedia;
