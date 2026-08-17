import { useRef } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useGlobal } from 'reactn';
import search from '../../../actions/search';
import getFriends from '../../../actions/getFriends';

function SearchBar() {
  const searchInput = useRef();
  const searchTimeout = useRef(null);
  const setSearchResults = useGlobal('searchResults')[1];
  const [nav, setNav] = useGlobal('nav');
  const setSearch = useGlobal('search')[1];

  const onChange = (e) => {
    const { value } = e.target;
    if (nav !== 'search') setNav('search');
    setSearch(value);

    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      // Empty query -> back to the mutual-friends default listing, not the
      // full directory (same rule as the initial /search page load).
      const request = value.trim() ? search(value) : getFriends();
      request
        .then((res) => setSearchResults(res.data.users))
        .catch((err) => console.log(err));
    }, 300);
  };

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
          placeholder="Search conversations..."
          ref={searchInput}
          value={searchVal}
          onChange={onChange}
        />
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground cursor-pointer hover:text-foreground" />
      </div>
    </div>
  );
}

export default SearchBar;
