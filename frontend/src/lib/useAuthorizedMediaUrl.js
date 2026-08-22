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
// `url` may be null/undefined (nothing to load yet) or a plain legacy URL
// that needs no auth — both pass straight through unchanged.
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

    axios.get(url, { responseType: 'blob' })
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

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, authorized]);

  return { url: resolvedUrl, loading, error };
};

export default useAuthorizedMediaUrl;
