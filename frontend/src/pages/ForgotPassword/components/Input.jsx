import { User, Lock, Mail, Pencil } from 'lucide-react';
import { Input as ShadInput } from '@/components/ui/input';

const ICONS = {
  user: User,
  lock: Lock,
  mail: Mail,
  pencil: Pencil,
};

function Input({ icon, placeholder, type, onChange, value }) {
  const Icon = ICONS[icon];

  return (
    <div className="relative mb-2 w-full">
      {Icon && (
        <Icon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      )}
      <ShadInput
        className="rounded-full pr-9"
        required
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

export default Input;
