import { useEffect } from 'react';
import { useGlobal } from 'reactn';
import { toast } from 'react-toastify';
import { Compass } from 'lucide-react';
import useTour from './useTour';
import ZephWordmark from '../components/ZephWordmark';

function FirstLoginTourSuggestionToastBody({ onAccept }) {
  return (
    <button
      type="button"
      onClick={onAccept}
      className="flex w-full cursor-pointer items-center gap-2.5 text-left"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Compass className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-foreground">New here?</div>
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <span>Take a quick tour of</span>
          <ZephWordmark className="text-xs font-medium" />
        </div>
      </div>
    </button>
  );
}

function FirstLoginTourSuggestion() {
  const [isNewRegistration, setIsNewRegistration] = useGlobal('isNewRegistration');
  const { start } = useTour('onboarding');

  useEffect(() => {
    if (!isNewRegistration) return;
    setIsNewRegistration(false);

    toast(
      <FirstLoginTourSuggestionToastBody onAccept={() => start()} />,
      { toastId: 'first-login-tour-suggestion', autoClose: 8000 },
    );
  }, [isNewRegistration]);

  return null;
}

export default FirstLoginTourSuggestion;
