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

// The upload to R2 is a plain XMLHttpRequest on purpose, NOT axios. axios attaches the user's login token
// (`Authorization: Bearer ...`) to every request by default, and R2 treats a request with an Authorization header as
// header-signed: it ignores the presigned link and answers 400 "Missing x-amz-content-sha256", without CORS headers
// (so the page only sees a CORS error while DevTools shows the 400). This request must carry nothing but the headers
// the server signed.
const putToStorage = (url, body, headers, onProgress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    Object.entries(headers || {}).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    if (onProgress) xhr.upload.onprogress = (event) => onProgress(event);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      const error = new Error(`Upload to storage failed (${xhr.status})`);
      // Same shape the axios-based error handling already reads.
      error.response = { status: xhr.status, data: { error: 'STORAGE_UPLOAD_FAILED', detail: String(xhr.responseText || '').slice(0, 300) } };
      reject(error);
    };
    xhr.onerror = () => {
      const error = new Error('Upload to storage failed (network or CORS)');
      error.response = { status: 0, data: { error: 'STORAGE_UPLOAD_FAILED' } };
      reject(error);
    };
    xhr.send(body);
  });

// Direct-to-R2 flow: presign -> PUT straight to R2 (bypasses this Node
// process entirely for the actual bytes) -> tell the server to validate/
// finalize it. See backend/src/routes/upload-media-presign.js and
// upload-media-complete.js for why validation only happens in the last
// step (the server never sees the bytes until then).
const uploadViaPresignedUrl = async (file, onProgress, poster) => {
  const presignUrl = `${Config.url || ''}/api/upload/media/presign`;
  const presignRes = await axios.post(presignUrl, {
    filename: file.name,
    size: file.size,
    poster: poster ? 'true' : undefined,
  });
  const { mediaId, uploadUrl, uploadHeaders, posterUploadUrl, posterUploadHeaders, posterStorageKey } = presignRes.data;

  // The headers the server signed (Content-Type chosen from the validated extension, plus cache/disposition) must be
  // sent exactly; they are NOT taken from the browser's own idea of the file's type (`file.type` is often empty or
  // carries codec parameters).
  await putToStorage(uploadUrl, file, uploadHeaders || { 'Content-Type': file.type }, onProgress);

  if (poster && posterUploadUrl) {
    await putToStorage(posterUploadUrl, poster, posterUploadHeaders || { 'Content-Type': 'image/jpeg' });
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
