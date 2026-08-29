import { useState, useCallback } from 'react';

/** Minimal show/hide flag for ZephLoadingOverlay. */
export default function useZephLoader(initial = false) {
  const [show, setShow] = useState(initial);
  return {
    show,
    start: useCallback(() => setShow(true), []),
    stop: useCallback(() => setShow(false), []),
  };
}
