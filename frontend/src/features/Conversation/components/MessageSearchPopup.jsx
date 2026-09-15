import { useRef } from 'react';
import { useGlobal } from 'reactn';
import moment from 'moment';
import { Search, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import searchMessages from '../../../actions/searchMessages';
import useExplicitSearch from '../../../lib/useExplicitSearch';

const MIN_QUERY_LENGTH = 2;

// In-conversation message search (TopBar's "Search" menu item). Explicit
// submit only (Enter/button), same debounce-free contract as
// Panel/SearchBar.jsx's people search — reuses useExplicitSearch rather
// than inventing a second query-cache/abort implementation.
function MessageSearchPopup({ roomID, onClose }) {
  const inputRef = useRef(null);
  const setPendingJump = useGlobal('pendingMessageJump')[1];

  const { query, setQuery, results, loading, hasSearched, search, reset } = useExplicitSearch(
    (value, signal) => searchMessages({ query: value, roomID }, signal).then((res) => res.data.messages || []),
    { minLength: MIN_QUERY_LENGTH },
  );

  const onSubmit = (e) => {
    e.preventDefault();
    search(query);
  };

  const jumpTo = (message) => {
    setPendingJump({ messageID: message._id });
    reset();
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="rounded-2xl border border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Search this conversation</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <Input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages"
            className="flex-1"
          />
          <Button type="submit" size="icon" variant="secondary" disabled={loading} aria-label="Search">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </form>

        <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {!hasSearched && (
            <p className="py-6 text-center text-xs text-muted-foreground">Type at least 2 characters and search.</p>
          )}
          {hasSearched && !loading && results.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">No messages found.</p>
          )}
          {results.map((message) => (
            <button
              type="button"
              key={message._id}
              onClick={() => jumpTo(message)}
              className="w-full rounded-xl px-3 py-2 text-left hover:bg-muted/50 cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {message.author ? `${message.author.firstName} ${message.author.lastName}` : 'Deleted User'}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {moment(message.date).format('MMM D, h:mm A')}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{message.content}</p>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MessageSearchPopup;
