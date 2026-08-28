import { useEffect } from 'react';
import { useGlobal } from 'reactn';
import { toast } from 'react-toastify';
import { Compass } from 'lucide-react';
import useTour from './useTour';

// Fires once, right after a brand-new account registers (never on a plain
// login — see Login/index.jsx's onRegister, the only place
// isNewRegistration is ever set true). Spec §7 is explicit: "Do NOT
// automatically force the tour immediately after login... prefer a
// subtle 'Take a tour' option." A toast — dismissible by its own timeout
// or an explicit click, never blocking anything — is about as subtle as an
// offer can be; the tour itself only starts if the user clicks it.
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
        <div className="text-xs text-muted-foreground">Take a quick tour of Chitcx</div>
      </div>
    </button>
  );
}

function FirstLoginTourSuggestion() {
  const [isNewRegistration, setIsNewRegistration] = useGlobal('isNewRegistration');
  const { start } = useTour('onboarding');

  useEffect(() => {
    if (!isNewRegistration) return;
    // Cleared immediately (not on toast dismiss/click) — this is a
    // one-time, this-session-only offer, never re-shown on a later visit
    // even if the toast times out unseen. Matches spec §7's "optional
    // first-login suggestion" framing, not a persistent nag.
    setIsNewRegistration(false);

    toast(
      <FirstLoginTourSuggestionToastBody onAccept={() => start()} />,
      { toastId: 'first-login-tour-suggestion', autoClose: 8000 },
    );
  }, [isNewRegistration]);

  return null;
}

export default FirstLoginTourSuggestion;
