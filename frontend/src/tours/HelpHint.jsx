import { HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import useTour from './useTour';

// Reusable "?" contextual-help affordance (spec §29) — opens a tour
// starting at a SPECIFIC step, not the whole tour from the beginning.
// Deliberately tiny: a component only ever needs to know its own tourId +
// which step index it corresponds to, never anything about driver.js or
// the registry (same "components never touch the tour system directly"
// rule useTour itself exists to enforce).
//
// Usage: <HelpHint tourId="groups" stepIndex={2} label="What is slow mode?" ctx={{ myRole }} />
function HelpHint({
  tourId, stepIndex = 0, label = 'Help', ctx, className = '',
}) {
  const { startAt } = useTour(tourId);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      className={`h-5 w-5 rounded-full text-muted-foreground hover:text-primary ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startAt(stepIndex, ctx);
      }}
    >
      <HelpCircle className="h-full w-full" />
    </Button>
  );
}

export default HelpHint;
