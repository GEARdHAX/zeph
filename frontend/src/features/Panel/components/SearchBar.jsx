import { useRef } from 'react';
import { Search } from 'lucide-react';
import { useGlobal } from 'reactn';
import search from '../../../actions/search';

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

    // Debounced: a search request per keystroke wastes data on slow/metered connections.
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      search(value)
        .then((res) => setSearchResults(res.data.users))
        .catch((err) => console.log(err));
    }, 300);
  };

  return (
    <div className="flex h-10 items-center border-b bg-muted">
      <Search
        className="ml-3 h-4 w-4 shrink-0 cursor-pointer text-muted-foreground"
        onClick={() => searchInput.current.focus()}
      />
      <input
        className="w-full bg-transparent px-2 text-sm outline-none"
        placeholder="Search"
        ref={searchInput}
        onChange={onChange}
      />
    </div>
  );
}

export default SearchBar;
