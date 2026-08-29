import { useGlobal } from 'reactn';
import Picture from '../../components/Picture';
import ZephWordmark from '../../components/ZephWordmark';
import Config from '../../config';

function Welcome() {
  const user = useGlobal('user')[0] || {};
  const version = useGlobal('version')[0];

  const fullName = `${user.firstName || 'Admin'} ${user.lastName || 'User'}`.trim();
  const initials = `${(user.firstName || 'A').charAt(0)}${(user.lastName || 'U').charAt(0)}`.toUpperCase();

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-background text-foreground">
      {/* Background Subtle Red Radial Ambient Glow */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[450px] w-[450px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-15 blur-[120px]"
        style={{ background: 'radial-gradient(circle, var(--color-primary, #e11d48) 0%, transparent 70%)' }}
      />

      {/* Main Center Area */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center z-10">
        {/* Name Title */}
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {fullName}
        </h2>

        {/* Large Center Avatar Circle with Glow & Gradient Border */}
        <div className="my-8 relative flex items-center justify-center">
          <div className="absolute -inset-2 rounded-full bg-gradient-to-tr from-primary/60 via-rose-600/30 to-transparent opacity-50 blur-md" />
          <div className="relative flex h-36 w-36 items-center justify-center rounded-full border border-border bg-gradient-to-b from-rose-700/80 to-primary/90 text-white shadow-2xl">
            {user.picture ? (
              <img
                src={`${Config.url || ''}/api/images/${user.picture.shieldedID}/512`}
                alt={fullName}
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              <span className="text-4xl font-extrabold tracking-wider text-white">
                {initials}
              </span>
            )}
          </div>
        </div>

        {/* Prompt Subtext */}
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground sm:text-sm">
          Search for someone to start a conversation,
          <br />
          Add contacts to your favorites to reach them faster
        </p>
      </div>

      {/* Bottom Status / Version Bar */}
      <div className="flex h-12 w-full items-center justify-end gap-1 px-6 text-xs text-muted-foreground border-t border-border/50">
        <ZephWordmark className="text-xs font-semibold" />
        <span>{`v${version || '2.9.1'}`}</span>
      </div>
    </div>
  );
}

export default Welcome;
