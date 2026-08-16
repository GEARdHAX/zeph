import { useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useGlobal } from 'reactn';
import { useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import search from '../../../actions/search';
import User from './User';
import postAdd from '../../../actions/postAdd';

function AddPeers({ onClose }) {
  const searchInput = useRef();
  const searchTimeout = useRef(null);
  const [searchResults, setSearchResults] = useGlobal('searchResults');
  const [searchText, setSearch] = useGlobal('search');
  const [selected, setSelected] = useState([]);

  const params = useParams();
  const roomID = params.id;

  const onChange = (e) => {
    const { value } = e.target;
    setSearch(value);

    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      search(value)
        .then((res) => setSearchResults(res.data.users))
        .catch((err) => console.log(err));
    }, 300);
  };

  const errorToast = (content) => toast.error(content);

  const call = async (user) => {
    setSelected([...selected, user._id]);
    try {
      await postAdd({ userID: user._id, meetingID: roomID });
    } catch (e) {
      errorToast('Server error. Unable to initiate call.');
    }
  };

  const searchResultsList = searchResults.map((user) => (
    <User
      key={user._id}
      user={user}
      onSelect={() => !selected.includes(user._id) && call(user)}
      selected={selected.includes(user._id)}
    />
  ));

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[400px] max-h-[90vh] flex-col p-0">
        <DialogHeader className="px-5 py-3.5">
          <DialogTitle>Add Peers</DialogTitle>
        </DialogHeader>
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
        <div className="flex-1 overflow-y-auto">
          {searchResultsList}
          {searchResults.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {`There are no search results for "${searchText}"`}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AddPeers;
