import { useState, Fragment, memo } from 'react';
import { Copy, Check, ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseMessage } from '../../../lib/parseMessage';

// Renders inline tokens with theme-aware styling for sender vs receiver bubbles
function InlineTokens({ tokens, isMine, onMentionClick, keyPrefix = 'tok' }) {
  if (!tokens || tokens.length === 0) return null;

  return tokens.map((token, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (token.type) {
      case 'bold':
        return (
          <strong key={key} className="font-semibold">
            <InlineTokens tokens={token.children} isMine={isMine} onMentionClick={onMentionClick} keyPrefix={key} />
          </strong>
        );
      case 'italic':
        return (
          <em key={key} className="italic">
            <InlineTokens tokens={token.children} isMine={isMine} onMentionClick={onMentionClick} keyPrefix={key} />
          </em>
        );
      case 'underline':
        return (
          <u key={key} className="underline underline-offset-2">
            <InlineTokens tokens={token.children} isMine={isMine} onMentionClick={onMentionClick} keyPrefix={key} />
          </u>
        );
      case 'strike':
        return (
          <s key={key} className="line-through opacity-75">
            <InlineTokens tokens={token.children} isMine={isMine} onMentionClick={onMentionClick} keyPrefix={key} />
          </s>
        );
      case 'highlight':
        return (
          <mark
            key={key}
            className={cn(
              'rounded px-1 py-0.5 text-inherit',
              isMine ? 'bg-amber-400/30 text-white' : 'bg-yellow-200 text-zinc-900 dark:bg-yellow-500/30 dark:text-yellow-100',
            )}
          >
            <InlineTokens tokens={token.children} isMine={isMine} onMentionClick={onMentionClick} keyPrefix={key} />
          </mark>
        );
      case 'code':
        return (
          <code
            key={key}
            className={cn(
              'rounded px-1.5 py-0.5 font-mono text-[0.88em] leading-none transition-colors select-text',
              isMine
                ? 'bg-black/25 text-rose-100 border border-white/10'
                : 'bg-black/10 dark:bg-white/10 text-foreground border border-border/40',
            )}
          >
            {token.text}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={cn(
              'underline underline-offset-2 transition-opacity hover:opacity-80 break-all',
              isMine ? 'text-rose-100 hover:text-white font-medium' : 'text-primary font-medium',
            )}
          >
            {token.text}
          </a>
        );
      case 'mention':
        return (
          <button
            key={key}
            type="button"
            disabled={!onMentionClick}
            onClick={() => onMentionClick?.(token.username)}
            className={cn(
              'font-semibold transition-opacity',
              isMine ? 'text-white underline hover:opacity-80' : 'text-primary hover:underline',
              onMentionClick ? 'cursor-pointer' : '',
            )}
          >
            {`@${token.username}`}
          </button>
        );
      case 'hashtag':
        return (
          <span
            key={key}
            className={cn(
              'font-medium',
              isMine ? 'text-rose-200' : 'text-primary',
            )}
          >
            {`#${token.tag}`}
          </span>
        );
      case 'break':
        return <br key={key} />;
      case 'text':
      default:
        return <Fragment key={key}>{token.text}</Fragment>;
    }
  });
}

// Dedicated code block component with syntax header & copy button
function CodeBlock({ block, isMine }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(block.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // ignore
    }
  };

  return (
    <div className="relative my-2.5 overflow-hidden rounded-xl border border-white/10 bg-[#0d1117] text-left shadow-lg">
      <div className="flex items-center justify-between border-b border-white/10 bg-black/40 px-3 py-1.5 text-[11px] font-mono text-zinc-400">
        <div className="flex items-center gap-1.5">
          <Terminal className="h-3 w-3 text-rose-400" />
          <span className="font-semibold uppercase tracking-wider text-[10px] text-zinc-300">
            {block.lang || (block.isDiagram ? 'diagram' : 'code')}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-sans font-medium text-zinc-300 hover:bg-white/10 transition-colors cursor-pointer"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400 text-[10px]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span className="text-[10px]">Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] font-mono leading-relaxed text-zinc-200 whitespace-pre scrollbar-thin">
        <code>{block.code}</code>
      </pre>
    </div>
  );
}

// Dedicated responsive table component
function TableBlock({ block, isMine }) {
  return (
    <div className="my-2.5 overflow-x-auto rounded-xl border border-border/50 bg-black/20 shadow-xs scrollbar-thin">
      <table className="w-full border-collapse text-left text-xs">
        {block.headers && block.headers.length > 0 && (
          <thead className={cn(isMine ? 'bg-black/30' : 'bg-muted/60')}>
            <tr>
              {block.headers.map((h, idx) => (
                <th
                  key={idx}
                  className="border-b border-border/40 px-3 py-2 text-[11px] font-semibold tracking-wider text-inherit uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {block.rows.map((row, rIdx) => (
            <tr
              key={rIdx}
              className={cn(
                'border-b border-border/20 last:border-0 transition-colors',
                rIdx % 2 === 1 && (isMine ? 'bg-black/15' : 'bg-muted/30'),
              )}
            >
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="px-3 py-1.5 text-xs text-inherit align-top whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MessageContent({ content, isMine, onMentionClick }) {
  const [expanded, setExpanded] = useState(false);

  if (!content) return null;

  const blocks = parseMessage(content);
  if (blocks.length === 0) return null;

  // Detect if message is very long (collapsible candidate)
  const isVeryLong = content.length > 800 || blocks.length > 7;

  return (
    <div className="relative text-inherit leading-relaxed">
      <div
        className={cn(
          'transition-[max-height] duration-300 ease-in-out',
          isVeryLong && !expanded && 'max-h-[320px] overflow-hidden',
        )}
      >
        <div className="space-y-2 text-[13px] sm:text-[13.5px] leading-relaxed break-words">
          {blocks.map((block, idx) => {
            switch (block.type) {
              case 'code_block':
                return <CodeBlock key={idx} block={block} isMine={isMine} />;

              case 'table':
                return <TableBlock key={idx} block={block} isMine={isMine} />;

              case 'header': {
                const HeaderTag = block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4';
                return (
                  <HeaderTag
                    key={idx}
                    className={cn(
                      'font-bold tracking-tight text-inherit pt-1.5 pb-0.5',
                      block.level === 1 && 'text-[15px] sm:text-base border-b border-current/20 pb-1',
                      block.level === 2 && 'text-[14px] sm:text-[15px]',
                      block.level >= 3 && 'text-[13px] sm:text-[13.5px]',
                    )}
                  >
                    <InlineTokens tokens={block.tokens} isMine={isMine} onMentionClick={onMentionClick} keyPrefix={`h-${idx}`} />
                  </HeaderTag>
                );
              }

              case 'quote':
                return (
                  <blockquote
                    key={idx}
                    className={cn(
                      'my-2 rounded-r-lg border-l-2 pl-3 py-1 italic text-xs sm:text-[13px]',
                      isMine ? 'border-white/50 bg-black/15 text-rose-100' : 'border-primary bg-muted/30 text-muted-foreground',
                    )}
                  >
                    <InlineTokens tokens={block.tokens} isMine={isMine} onMentionClick={onMentionClick} keyPrefix={`q-${idx}`} />
                  </blockquote>
                );

              case 'list':
                return (
                  <div key={idx} className="my-1.5 space-y-1 pl-2">
                    {block.items.map((item, itemIdx) => (
                      <div key={itemIdx} className="flex items-start gap-2 text-xs sm:text-[13px] leading-relaxed">
                        <span
                          className={cn(
                            'font-mono text-xs select-none shrink-0 mt-0.5',
                            isMine ? 'text-rose-200' : 'text-muted-foreground',
                          )}
                        >
                          {item.marker}
                        </span>
                        <div className="flex-1">
                          <InlineTokens tokens={item.tokens} isMine={isMine} onMentionClick={onMentionClick} keyPrefix={`li-${idx}-${itemIdx}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                );

              case 'divider':
                return (
                  <hr
                    key={idx}
                    className={cn('my-3 border-t', isMine ? 'border-white/20' : 'border-border/60')}
                  />
                );

              case 'paragraph':
              default:
                return (
                  <p key={idx} className="my-1 text-inherit">
                    <InlineTokens tokens={block.tokens} isMine={isMine} onMentionClick={onMentionClick} keyPrefix={`p-${idx}`} />
                  </p>
                );
            }
          })}
        </div>
      </div>

      {/* Collapsible fade overlay & toggle */}
      {isVeryLong && !expanded && (
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 h-28 flex items-end justify-center pb-1 pointer-events-none rounded-b-xl',
            isMine
              ? 'bg-gradient-to-t from-[#991b1b] via-[#991b1b]/90 to-transparent'
              : 'bg-gradient-to-t from-card dark:from-[#18181b] via-card/90 dark:via-[#18181b]/90 to-transparent',
          )}
        >
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className={cn(
              'pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold shadow-md backdrop-blur-md cursor-pointer transition-all hover:scale-105 active:scale-95',
              isMine
                ? 'bg-black/40 hover:bg-black/60 text-white border border-white/20'
                : 'bg-background hover:bg-muted text-foreground border border-border/80',
            )}
          >
            <ChevronDown className="h-3.5 w-3.5" />
            <span>Show more</span>
          </button>
        </div>
      )}

      {isVeryLong && expanded && (
        <div className="mt-2.5 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors',
              isMine
                ? 'bg-black/30 hover:bg-black/50 text-rose-100 border border-white/10'
                : 'bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/50',
            )}
          >
            <ChevronUp className="h-3 w-3" />
            <span>Show less</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(MessageContent);
