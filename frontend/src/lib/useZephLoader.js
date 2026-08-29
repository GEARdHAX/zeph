import { useGlobal } from 'reactn';

// A reactn global (not local useState) — App.jsx's overlay mount and
// whatever component triggers it (e.g. Login/index.jsx) are different
// parts of the tree, so the loading flag has to be shared state, not
// component-local.
const useZephLoader = () => {
  const [zephLoading, setZephLoading] = useGlobal('zephLoading');

  const show = (label) => setZephLoading(label || true);
  const hide = () => setZephLoading(false);

  return {
    isLoading: !!zephLoading,
    label: typeof zephLoading === 'string' ? zephLoading : undefined,
    show,
    hide,
  };
};

export default useZephLoader;
