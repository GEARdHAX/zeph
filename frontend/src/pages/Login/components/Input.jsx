import { useState } from 'react';
import {
  User, Lock, Mail, Pencil, Eye, EyeOff,
} from 'lucide-react';
import { Input as ShadInput } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const ICONS = {
  user: User,
  lock: Lock,
  mail: Mail,
  pencil: Pencil,
};

function Input({
  id, icon, placeholder, type, onChange, value, className, ...props
}) {
  const Icon = ICONS[icon];
  const isPassword = type === 'password';
  const [revealed, setRevealed] = useState(false);

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
        required
        placeholder={placeholder}
        type={isPassword && revealed ? 'text' : type}
        value={value}
        onChange={onChange}
        {...props}
      />
      {isPassword && (
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 transition-colors hover:text-foreground focus:outline-none"
          onClick={() => setRevealed(!revealed)}
          aria-label={revealed ? 'Hide password' : 'Show password'}
        >
          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

export default Input;
