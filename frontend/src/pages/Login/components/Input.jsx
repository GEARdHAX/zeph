import {
  User, Lock, Mail, Pencil, Eye, EyeOff,
} from 'lucide-react';
import { Input as ShadInput } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Icon inferred from the field's stable `id` — Login/index.jsx doesn't pass
// an explicit `icon` prop at any call site, so this keeps every field's
// icon without having to touch every call site individually. Extend this
// map, don't add a new prop, when a new field id needs an icon.
const ICON_BY_ID = {
  'login-email': Mail,
  'login-password': Lock,
  'reg-first-name': Pencil,
  'reg-last-name': Pencil,
  'reg-username': User,
  'reg-email': Mail,
  'reg-password': Lock,
  'reg-repeat-password': Lock,
  'forgot-email': Mail,
  'forgot-code': Lock,
  'forgot-new-password': Lock,
};

// Controlled component: Login/index.jsx owns the show/hide-password state
// (showLoginPassword, etc. — driving `type` and `showPassword` itself) and
// passes isPassword/showPassword/onTogglePassword explicitly. This must
// stay a thin wrapper around ShadInput, not manage its own internal
// reveal state — a previous version did both (derived isPassword from
// `type` itself, kept its own `revealed` state), which left the caller's
// state fully disconnected from what actually rendered, and dumped
// isPassword/showPassword/onTogglePassword straight onto the DOM <input>
// via {...props} (visible as React "unknown prop"/"unrecognized event
// handler" console warnings on every render of this page).
function Input({
  id, type, placeholder, value, onChange, className, isPassword, showPassword, onTogglePassword,
  // `icon` is intentionally destructured-and-discarded, not read: the icon
  // is derived from `id` via ICON_BY_ID above, not a caller-supplied prop.
  // Left here only so a stray icon="..." at an old call site (e.g.
  // ForgotPassword's) is swallowed instead of leaking onto the DOM <input>
  // via {...props} (the exact class of "unknown prop" React warning this
  // component was rewritten to stop doing).
  icon,
  ...props
}) {
  const Icon = ICON_BY_ID[id];

  return (
    <div className="relative w-full">
      {Icon && (
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors" />
      )}
      <ShadInput
        id={id}
        className={cn(
          'h-11 w-full rounded-xl border border-input bg-background/50 px-3.5 text-sm transition-all duration-200 placeholder:text-muted-foreground/60 hover:border-input/80 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 dark:bg-card/40',
          Icon && 'pl-10',
          isPassword && 'pr-10',
          className,
        )}
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={onChange}
        {...props}
      />
      {isPassword && (
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 transition-colors hover:text-foreground focus:outline-none"
          onClick={onTogglePassword}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

export default Input;
