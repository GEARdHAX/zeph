import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import scrollToSection from './scrollToSection';

// Centered hero copy — now that there's no right-side globe to balance
// against, the full hero column (headline, description, CTAs, chips) is
// centered at every breakpoint, matching WebThreads' center-pinched wave.
function Hero() {
  return (
    <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 pt-[92px] pb-3 text-center sm:pt-24 md:pt-0 md:pb-0 lg:px-20">
      {/* 2. Editorial block: Headline + Description */}
      <div className="mb-5 flex flex-col items-center py-0.5 sm:mb-6 md:mb-8">
        <h1 data-aos="fade-up" className="text-[2.25rem] font-bold leading-[1.08] tracking-tight text-white sm:text-5xl md:text-6xl lg:text-7xl">
          Connections
          <br />
          <span className="text-primary">that flow.</span>
        </h1>

        <p data-aos="fade-up" data-aos-delay="100" className="mt-2.5 max-w-[280px] text-sm text-white/55 leading-relaxed sm:mt-3.5 sm:max-w-[360px] sm:text-base md:max-w-[480px] md:text-xl">
          Chat, meetings and AI in one connected space.
        </p>
        <p data-aos="fade-up" data-aos-delay="160" className="mt-1.5 max-w-[280px] text-xs text-white/35 leading-relaxed sm:max-w-[360px] sm:text-sm md:max-w-[480px] md:text-base">
          Built for conversations that move with you.
        </p>
      </div>

      {/* 3. CTA buttons */}
      <div data-aos="fade-up" data-aos-delay="240" className="flex flex-shrink-0 flex-wrap items-center justify-center gap-2.5 sm:gap-3">
        <Button
          asChild
          size="lg"
          className="rounded-full px-5 sm:px-6 bg-primary text-primary-foreground shadow-[0_0_24px_rgba(225,29,72,0.4)] hover:bg-primary/90 transition-shadow active:scale-95 text-sm sm:text-base"
        >
          <Link to="/login">
            Get started
            <ArrowRight className="size-4" />
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          size="lg"
          className="rounded-full border-white/15 bg-white/[0.04] px-5 sm:px-6 text-white hover:bg-white/10 hover:text-white active:scale-95 text-sm sm:text-base"
        >
          <a href="#product" onClick={(e) => scrollToSection(e, '#product')}>
            Explore product
          </a>
        </Button>
      </div>

      {/* 4. Trust/feature chips — small supporting detail under the CTAs,
          understated so they don't compete with the headline/buttons. */}
      <div data-aos="fade-up" data-aos-delay="320" className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:mt-7 md:mt-9">
        {['Server-enforced access', 'Real-time sync', 'AI-assisted'].map((label) => (
          <div key={label} className="flex items-center gap-1.5 text-xs text-white/35">
            <span className="size-1 rounded-full bg-white/25" />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Hero;
