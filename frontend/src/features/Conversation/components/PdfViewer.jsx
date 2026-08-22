import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Browser-native PDF rendering via <iframe> — no PDF.js/react-pdf dependency.
// Not every mobile browser renders a PDF inline, so a visible fallback link
// stays present at all times rather than only appearing on iframe failure
// (an <iframe> load/error event is unreliable for detecting "rendered a PDF"
// vs "rendered a plugin-missing blank page").
function PdfViewer({ src, filename }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="relative flex-1 overflow-hidden rounded-lg bg-white">
        <iframe
          src={src}
          title={filename || 'Document preview'}
          onLoad={() => setLoaded(true)}
          className="h-full w-full border-0"
        />
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-white text-xs text-black/50">
            Loading document…
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        asChild
        className="w-fit gap-1.5 self-center text-xs text-white/70 hover:bg-white/10 hover:text-white"
      >
        <a href={src} target="_blank" rel="noreferrer">
          <ExternalLink className="h-3.5 w-3.5" />
          Open original
        </a>
      </Button>
    </div>
  );
}

export default PdfViewer;
