import { useEffect, useState } from 'react';
import { useGlobal } from 'reactn';
import { Button } from '@/components/ui/button';
import TopBar from '../components/TopBar';
import SearchBar from '../components/SearchBar';
import User from '../components/User';
import search from '../../../actions/search';

function CreateGroupStepOne() {
  const setPanel = useGlobal('panel')[1];
  const user = useGlobal('user')[0];
  const searchText = useGlobal('search')[0];
  const [newGroupUsers, setNewGroupUsers] = useGlobal('newGroupUsers');
  const [searchResults, setSearchResults] = useGlobal('searchResults');
  const [error, setError] = useState(false);

  useEffect(() => {
    search()
      .then((res) => setSearchResults(res.data.users))
      .catch((err) => console.log(err));
  }, [setSearchResults]);

  useEffect(() => {
    setNewGroupUsers([user.id]);
  }, [user]);

  const onSelect = (id) => {
    if (newGroupUsers.includes(id)) {
      setNewGroupUsers(newGroupUsers.filter((u) => u !== id));
    } else {
      setError(false);
      setNewGroupUsers([...newGroupUsers, id]);
    }
  };

  const searchResultsList = searchResults.map((resultUser) => (
    <User
      key={resultUser._id}
      user={resultUser}
      selected={newGroupUsers.includes(resultUser._id)}
      onSelect={() => onSelect(resultUser._id)}
    />
  ));

  const createGroup = (e) => {
    e.preventDefault();
    if (newGroupUsers.length > 1) setPanel('createGroup2');
    else setError(true);
  };

  const selectedCount = newGroupUsers.length - 1;
  const hasSelection = newGroupUsers.length > 1;

  return (
    <div className="flex h-full flex-1 flex-col border-r sm:w-full md:max-w-[300px] md:min-w-[300px] lg:max-w-[360px] lg:min-w-[360px]">
      <TopBar back={() => setPanel('standard')} />
      <SearchBar />
      <Button className="w-full rounded-none" onClick={createGroup}>
        Select Users
      </Button>
      {hasSelection && error && (
        <div className="bg-muted px-3 py-3 text-center text-sm text-blue-700">You must select some people!</div>
      )}
      {hasSelection && (
        <div className="flex items-center justify-center gap-1 bg-muted px-3 py-3 text-center text-sm text-muted-foreground">
          {`${selectedCount} selected -`}
          <button type="button" className="underline" onClick={() => setNewGroupUsers([user.id])}>
            Clear
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {searchResultsList}
        {searchResults.length === 0 && (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {`There are no users available for "${searchText}"`}
          </div>
        )}
      </div>
    </div>
  );
}

export default CreateGroupStepOne;
