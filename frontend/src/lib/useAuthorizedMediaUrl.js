import { useEffect, useState } from 'react';
import axios from 'axios';

// Native <audio>/<video>/<img src=...> requests never carry a custom
// Authorization header — the browser makes that request itself, not axios.
// The new /api/media/:id route requires that header (unlike the legacy
// unauthenticated /api/images|files/:id routes, which stay untouched and
// keep working as a plain `src`). This hook fetches an authenticated URL
// through axios (which DOES attach the header via setAuthToken.js) as a
// Blob, then hands the element a local blob: URL to actually render —
// same authorized bytes, just retrieved through a request that can prove
// who's asking.
//
// CDN path: when the backend has the Cloudflare CDN configured, `<url>/url` answers (after the
// same auth + room-membership check) with a short-lived signed edge URL, and that URL is handed
// to the element directly: no blob download, Range/seek works, Render is out of the data path.
// If the CDN is off (404 CDN_NOT_ENABLED, remembered for the page's lifetime), the object is an
// older one (404 CDN_NOT_AVAILABLE), or anything else fails, the original authenticated blob
// path below runs unchanged.
//
// `url` may be null/undefined (nothing to load yet) or a plain legacy URL
// that needs no auth - both pass straight through unchanged.
let cdnDisabled = false;
export const resetCdnState = () => {
  cdnDisabled = false;
};

const useAuthorizedMediaUrl = (url, { authorized = true } = {}) => {
  const [resolvedUrl, setResolvedUrl] = useState(authorized ? null : url);
  const [loading, setLoading] = useState(authorized && !!url);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!authorized) {
      setResolvedUrl(url);
      setLoading(false);
      setError(false);
      return undefined;
    }
    if (!url) {
      setResolvedUrl(null);
      setLoading(false);
      setError(false);
      return undefined;
    }

    let cancelled = false;
    let objectUrl = null;
    setLoading(true);
    setError(false);
    setResolvedUrl(null);

    const viaBlob = () =>
      axios
        .get(url, { responseType: 'blob' })
        .then((res) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(res.data);
          setResolvedUrl(objectUrl);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setError(true);
          setLoading(false);
        });

    const viaCdn = cdnDisabled
      ? Promise.resolve(false)
      : axios
          .get(`${url}/url`)
          .then((res) => {
            const signed = res && res.data && res.data.url;
            if (!signed) return false;
            if (!cancelled) {
              setResolvedUrl(signed);
              setLoading(false);
            }
            return true;
          })
          .catch((err) => {
            if (err && err.response && err.response.data && err.response.data.error === 'CDN_NOT_ENABLED') cdnDisabled = true;
            return false;
          });

    viaCdn.then((served) => {
      if (!served && !cancelled) viaBlob();
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, authorized]);

  return { url: resolvedUrl, loading, error };
};

export default useAuthorizedMediaUrl;
