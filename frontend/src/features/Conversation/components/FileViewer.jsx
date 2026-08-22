import { memo } from 'react';
import { Download, FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import formatFileSize from '../../../lib/formatFileSize';
import getFileIcon from '../../../lib/fileIcon';
import downloadFile from '../../../lib/downloadFile';

// Generic file-preview card — used both for genuinely "other" file types and
// as the graceful fallback for anything detection can't categorize
// (unsupported/unknown), so there's exactly one "we can't preview this,
// here's what we know" code path rather than two.
function FileViewer({
  src, filename, size, unsupported,
}) {
  const Icon = unsupported ? FileQuestion : getFileIcon(filename);
  const extension = (filename || '').split('.').pop()?.toUpperCase();

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10">
        <Icon className="h-8 w-8 text-white/80" />
      </div>

      <div className="flex flex-col gap-1">
        <span className="max-w-[240px] truncate text-sm font-semibold text-white">
          {filename || 'Unknown file'}
        </span>
        <span className="text-xs text-white/50">
          {unsupported ? 'Preview unavailable' : (extension || 'File')}
          {' · '}
          {formatFileSize(size)}
        </span>
      </div>

      <Button
        type="button"
        className="gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
        onClick={() => downloadFile(src, filename)}
      >
        <Download className="h-4 w-4" />
        Download
      </Button>
    </div>
  );
}

export default memo(FileViewer);
