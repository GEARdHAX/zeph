import { useGlobal } from 'reactn';

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
