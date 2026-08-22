import { Fragment } from 'react';
import parseBio from '../lib/parseBio';

// Renders parseBio()'s typed token array as plain React elements — never
// dangerouslySetInnerHTML, so there is no HTML-injection surface at all
// (a raw '<script>' in a bio renders as the literal visible text
// "<script>", not as markup). Reused everywhere a bio is shown (Settings,
// ProfileView) and for the live edit-preview (EditBioPopup), so preview
// and final display can never drift apart — same parser, same renderer.
//
// `onMentionClick(username)` is optional — callers that can usefully react
// to a mention click (e.g. open that user's profile) pass it; callers that
// can't (e.g. the edit-preview pane) simply omit it, and mentions still
// render as visible, styled text either way.
const renderTokens = (tokens, onMentionClick, keyPrefix) => tokens.map((token, i) => {
  const key = `${keyPrefix}-${i}`;
  switch (token.type) {
    case 'bold':
      return <strong key={key}>{renderTokens(token.children, onMentionClick, key)}</strong>;
    case 'italic':
      return <em key={key}>{renderTokens(token.children, onMentionClick, key)}</em>;
    case 'underline':
      return <u key={key}>{renderTokens(token.children, onMentionClick, key)}</u>;
    case 'strike':
      return <s key={key}>{renderTokens(token.children, onMentionClick, key)}</s>;
    case 'highlight':
      return (
        <mark key={key} className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-500/30">
          {renderTokens(token.children, onMentionClick, key)}
        </mark>
      );
    case 'code':
      return (
        <code key={key} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.9em] dark:bg-white/10">
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
          className="text-primary underline hover:opacity-80"
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
          className={onMentionClick
            ? 'font-medium text-primary hover:underline cursor-pointer'
            : 'font-medium text-primary'}
        >
          {`@${token.username}`}
        </button>
      );
    case 'hashtag':
      return (
        <span key={key} className="font-medium text-primary">
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

function BioText({ text, onMentionClick, className }) {
  const tokens = parseBio(text);
  if (tokens.length === 0) return null;
  return <span className={className}>{renderTokens(tokens, onMentionClick, 'bio')}</span>;
}

export default BioText;
