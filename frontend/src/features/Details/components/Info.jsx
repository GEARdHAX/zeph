import { useGlobal } from 'reactn';
import BrandLogo from '../../../components/BrandLogo';
import ZephWordmark from '../../../components/ZephWordmark';
import Config from '../../../config';

function Info() {
  const version = useGlobal('version')[0];

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-card p-8 text-card-foreground">
      {/* Decorative ambient background mesh */}
      <div
        className="pointer-events-none absolute -bottom-20 -right-20 h-64 w-64 rounded-full opacity-10 blur-[80px]"
        style={{ background: 'radial-gradient(circle, var(--color-primary, #e11d48) 0%, transparent 70%)' }}
      />

      {/* Top / Middle content */}
      <div className="flex flex-col items-center pt-8 text-center z-10">
        {/* Brand Icon */}
        <div className="mb-6 flex h-20 w-20 items-center justify-center">
          <BrandLogo className="h-16 w-16" />
        </div>

        {/* Welcome Title — mid-sentence, so the plain (no-period) shortName
            reads correctly rather than a styled wordmark forcing a period
            right before the "!" ("Welcome to zeph.!" looks wrong). */}
        <h3 className="text-base font-bold text-foreground sm:text-lg">
          {`Welcome to ${Config.shortName}!`}
        </h3>

        {/* Description — same mid-sentence reasoning. */}
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          {`${Config.shortName} is a messaging app that enables real-time messaging, audio and video calls, groups and conferencing.`}
        </p>
      </div>

      {/* Footer Branding — title-style, standalone: the full styled wordmark applies here. */}
      <div className="flex flex-col items-center text-center text-xs text-muted-foreground z-10">
        <div className="flex items-center gap-1">
          <span>Copyright ©</span>
          <ZephWordmark className="text-xs font-semibold" />
        </div>
        <div className="mt-1">{`v${version || '2.9.1'}`}</div>
      </div>
    </div>
  );
}

export default Info;
