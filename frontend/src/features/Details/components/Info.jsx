import { useGlobal } from 'reactn';
import logo from '../../../assets/logo.png';
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
          <img src={logo} alt="Chitcx" className="h-16 w-16 object-contain" />
        </div>

        {/* Welcome Title */}
        <h3 className="text-base font-bold text-foreground sm:text-lg">
          {`Welcome to ${Config.brand || 'Chitcx'}!`}
        </h3>

        {/* Description */}
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          {`${Config.brand || 'Chitcx'} is a messaging app that enables real-time messaging, audio and video calls, groups and conferencing.`}
        </p>
      </div>

      {/* Footer Branding */}
      <div className="text-center text-xs text-muted-foreground z-10">
        <div>{`Copyright © ${(Config.brand || 'ADARSH ARYA')}`}</div>
        <div className="mt-1">{`v${version || '2.9.1'}`}</div>
      </div>
    </div>
  );
}

export default Info;
