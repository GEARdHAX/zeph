import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { ZephWordmark } from '@/components/ZephWordmark';
import { Button } from '@/components/ui/button';
import useLandingPath from '@/lib/useLandingPath';
import scrollToSection from './scrollToSection';

// Section links scroll in place on the landing page; from any other page
// (e.g. /about) they navigate to the landing page with #section. `About` is its own page.
const NAV_LINKS = [
  { label: 'Product', href: '#product' },
  { label: 'Features', href: '#features' },
  { label: 'Security', href: '#security' },
  { label: 'About', to: '/about' },
];

// One renderer for a nav link so the desktop bar and the mobile dropdown can't
// drift: in-page scroll on the landing page, /landing#section elsewhere.
function NavItem({ link, pathname, onLanding, landingPath, className, activeClassName = 'text-white', idleClassName = 'text-white/60', onNavigate }) {
  if (link.to) {
    const current = pathname === link.to;
    return (
      <Link
        to={link.to}
        onClick={onNavigate}
        aria-current={current ? 'page' : undefined}
        className={`${className} ${current ? activeClassName : idleClassName}`}
      >
        {link.label}
      </Link>
    );
  }
  if (onLanding) {
    return (
      <a
        href={link.href}
        onClick={(e) => {
          scrollToSection(e, link.href);
          onNavigate?.();
        }}
        className={`${className} ${idleClassName}`}
      >
        {link.label}
      </a>
    );
  }
  return (
    <Link to={{ pathname: landingPath, hash: link.href }} onClick={onNavigate} className={`${className} ${idleClassName}`}>
      {link.label}
    </Link>
  );
}

// Floating pill navbar for the landing page only — not the in-app TopBar
// variants under src/features/*, which are a different, fixed-chrome
// pattern for the logged-in product shell.
function Navbar() {
  const { pathname } = useLocation();
  const landingPath = useLandingPath();
  const onLanding = pathname === '/' || pathname === '/landing';
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef(null);
  const toggleRef = useRef(null);
  const closeMenu = () => setMenuOpen(false);

  // Non-modal dropdown: close on outside press and Escape. (No scroll lock —
  // the page scrolls in its own container and in-page links must still work.)
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (e) => {
      if (!wrapperRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="absolute inset-x-0 top-5 z-20 flex justify-center px-4 md:top-6">
      <div ref={wrapperRef} className="relative w-full max-w-[1320px]">
        <nav
          className="flex w-full items-center justify-between gap-4 rounded-full border border-white/10 bg-[rgba(12,12,12,0.72)] px-4 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-md md:px-6"
          aria-label="Primary"
        >
          <Link to={landingPath} className="flex shrink-0 items-center gap-2">
            <BrandLogo variant="dark" className="h-7 w-7" />
            <ZephWordmark className="text-lg font-semibold text-white" />
          </Link>

          <ul className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <NavItem link={link} pathname={pathname} onLanding={onLanding} landingPath={landingPath} className="text-sm font-medium transition-colors hover:text-white" />
              </li>
            ))}
          </ul>

          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <Link to="/login" className="px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:text-white">
              Sign in
            </Link>
            <Button asChild size="sm" className="rounded-full px-4">
              <Link to="/login">Get started</Link>
            </Button>
          </div>

          <Button
            ref={toggleRef}
            variant="ghost"
            size="icon-sm"
            className="text-white/80 hover:bg-white/10 hover:text-white md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </nav>

        {/* Dropdown hung off the pill: same border, fill, blur and shadow, same
            width, so it reads as the navbar unfolding. Kept mounted and toggled
            with opacity/transform so it can animate; `invisible` removes it from
            the tab order and the accessibility tree while closed. */}
        <div
          id="mobile-menu"
          data-open={menuOpen}
          className="invisible absolute inset-x-0 top-full mt-2 origin-top -translate-y-2 scale-[0.98] rounded-3xl border border-white/10 bg-[rgba(12,12,12,0.9)] p-2 opacity-0 shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-md transition-[opacity,transform,visibility] duration-200 ease-out data-[open=true]:visible data-[open=true]:translate-y-0 data-[open=true]:scale-100 data-[open=true]:opacity-100 motion-reduce:transition-none md:hidden"
        >
          <ul className="flex flex-col">
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <NavItem
                  link={link}
                  pathname={pathname}
                  onLanding={onLanding}
                  landingPath={landingPath}
                  onNavigate={closeMenu}
                  className="block rounded-2xl px-4 py-3 text-base font-medium transition-colors hover:bg-white/[0.06] hover:text-white"
                  idleClassName="text-white/70"
                />
              </li>
            ))}
          </ul>
          <div className="mt-1 flex flex-col gap-2 border-t border-white/10 p-2 pt-3">
            <Button asChild size="lg" className="rounded-full">
              <Link to="/login" onClick={closeMenu}>
                Get started
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="rounded-full border-white/15 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white"
            >
              <Link to="/login" onClick={closeMenu}>
                Sign in
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Navbar;
