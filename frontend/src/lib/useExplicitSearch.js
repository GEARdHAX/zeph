import { useRef, useState } from 'react';

const DEFAULT_STALE_TIME_MS = 5 * 60 * 1000;

// Explicit-trigger server search (Enter/click, not every keystroke) with a
// tiny in-memory query->result cache and abort-on-resubmit — the same shape
// React Query would give this feature, built on plain React state since
// this project's locked stack is Redux+reactn+axios, not React Query (see
// CLAUDE.md; confirmed zero React Query usage anywhere in this codebase).
// A second query->result Map per hook instance is the whole "cache layer" —
// deliberately minimal, no new dependency, no global cache to keep in sync.
//
// Guarantees:
// - Nothing fires until `search()` is called explicitly.
// - A query shorter than minLength is rejected without a request.
// - A fresh cache hit (within staleTime) returns instantly, no request.
// - Calling search() again while a request is in flight aborts the
//   in-flight one first, so a slow earlier response can never overwrite a
//   later one's results (the actual race-condition fix — not just a longer
//   debounce).
const useExplicitSearch = (fetcher, { minLength = 3, staleTime = DEFAULT_STALE_TIME_MS } = {}) => {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  // Distinguishes "never submitted yet" from "submitted, zero results" —
  // the empty-state message needs to tell those apart.
  const [hasSearched, setHasSearched] = useState(false);

  const cacheRef = useRef(new Map()); // query -> { data, expiresAt }
  const abortRef = useRef(null);
  const latestQueryRef = useRef(null); // guards against an aborted-but-still-resolving promise

  const search = (rawQuery) => {
    const trimmed = (rawQuery ?? query).trim();
    setQuery(trimmed);

    if (trimmed.length < minLength) {
      setResults([]);
      setLoading(false);
      return;
    }

    const cached = cacheRef.current.get(trimmed);
    if (cached && cached.expiresAt > Date.now()) {
      setResults(cached.data);
      setLoading(false);
      setHasSearched(true);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    latestQueryRef.current = trimmed;

    setLoading(true);
    fetcher(trimmed, controller.signal)
      .then((data) => {
        if (controller.signal.aborted || latestQueryRef.current !== trimmed) return;
        cacheRef.current.set(trimmed, { data, expiresAt: Date.now() + staleTime });
        setResults(data);
        setLoading(false);
        setHasSearched(true);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setHasSearched(true);
      });
  };

  const reset = () => {
    if (abortRef.current) abortRef.current.abort();
    setQuery('');
    setResults([]);
    setLoading(false);
    setHasSearched(false);
  };

  return {
    query, setQuery, results, loading, hasSearched, search, reset,
  };
};

export default useExplicitSearch;
