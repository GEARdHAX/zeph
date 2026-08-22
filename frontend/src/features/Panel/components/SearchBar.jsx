import { useEffect, useRef } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useGlobal } from 'reactn';
import search from '../../../actions/search';
import useExplicitSearch from '../../../lib/useExplicitSearch';

const MIN_PEOPLE_QUERY_LENGTH = 3;

function SearchBar() {
  const searchInput = useRef();
  const setSearch = useGlobal('search')[1];
  const [, setSearchResults] = useGlobal('searchResults');

  // Typing here filters the already-cached conversation list locally (see
  // Panel.jsx's useMemo) — zero requests for that. Finding someone to START
  // a NEW conversation with is a separate, unbounded dataset (the full user
  // directory) that can't be client-cached the same way — it only searches
  // on explicit submit (Enter), never per keystroke, same contract as
  // AddPeople.jsx (see useExplicitSearch).
  const {
    results, search: runPeopleSearch, reset: resetPeopleSearch,
  } = useExplicitSearch(
    (value, signal) => search(value, undefined, signal).then((res) => res.data.users || []),
    { minLength: MIN_PEOPLE_QUERY_LENGTH },
  );

  // The reactn `search` global stays the single source of truth for the
  // input value (also drives Panel.jsx's local conversation filter) — the
  // People lookup is derived from it on explicit submit only.
  const onChange = (e) => {
    const { value } = e.target;
    setSearch(value);
    if (!value.trim()) resetPeopleSearch();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') runPeopleSearch(e.target.value);
  };

  // Keep the reactn `searchResults` global (consumed by Panel.jsx's "People"
  // section) in sync with the hook's own result state.
  useEffect(() => {
    setSearchResults(results);
  }, [results, setSearchResults]);

  const searchVal = useGlobal('search')[0] || '';

  return (
    <div className="px-4 py-2">
      <div className="relative flex h-10 w-full items-center rounded-xl border border-input bg-muted/40 px-3.5 transition-colors focus-within:border-primary/50 focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/20">
        <Search
          className="h-4 w-4 shrink-0 cursor-pointer text-muted-foreground"
          onClick={() => searchInput.current?.focus()}
        />
        <input
          className="w-full bg-transparent px-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none"
          placeholder="Search conversations, then Enter for people..."
          ref={searchInput}
          value={searchVal}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground cursor-pointer hover:text-foreground" />
      </div>
    </div>
  );
}

export default SearchBar;
