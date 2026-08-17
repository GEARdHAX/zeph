import { useEffect, useState } from 'react';
import { useGlobal } from 'reactn';
import { ArrowRight, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TopBar from '../components/TopBar';
import SearchBar from '../components/SearchBar';
import User from '../components/User';
import search from '../../../actions/search';

function CreateGroupStepOne() {
  const setPanel = useGlobal('panel')[1];
  const user = useGlobal('user')[0] || {};
  const searchText = useGlobal('search')[0];
  const [newGroupUsers, setNewGroupUsers] = useGlobal('newGroupUsers');
  const [searchResults, setSearchResults] = useGlobal('searchResults');
  const [error, setError] = useState(false);

  useEffect(() => {
    search()
      .then((res) => setSearchResults(res.data.users || []))
      .catch((err) => console.log(err));
  }, [setSearchResults]);

  useEffect(() => {
    if (user.id) {
      setNewGroupUsers([user.id]);
    }
  }, [user]);

  const onSelect = (id) => {
    if (newGroupUsers.includes(id)) {
      setNewGroupUsers(newGroupUsers.filter((u) => u !== id));
    } else {
      setError(false);
      setNewGroupUsers([...newGroupUsers, id]);
    }
  };

  const searchResultsList = (searchResults || []).map((resultUser) => (
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

  const selectedCount = Math.max(0, newGroupUsers.length - 1);
  const hasSelection = newGroupUsers.length > 1;

  return (
    <div className="flex h-full flex-1 flex-col border-r border-border/60 bg-card text-foreground sm:w-full md:max-w-[320px] md:min-w-[320px] lg:max-w-[360px] lg:min-w-[360px]">
      <TopBar back={() => setPanel('standard')} />
      <SearchBar />

      {/* Selected Users Chips & Action Banner */}
      <div className="px-4 py-2">
        <Button
          className="w-full gap-2 rounded-xl bg-primary text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          onClick={createGroup}
          disabled={!hasSelection}
        >
          <span>Next: Group Details</span>
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {hasSelection && (
        <div className="flex items-center justify-between border-y border-border/60 bg-muted/40 px-4 py-2 text-xs">
          <span className="font-semibold text-foreground">
            {`${selectedCount} participant${selectedCount > 1 ? 's' : ''} selected`}
          </span>
          <button
            type="button"
            className="flex items-center gap-1 text-primary hover:underline"
            onClick={() => setNewGroupUsers([user.id])}
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        </div>
      )}

      {error && !hasSelection && (
        <div className="mx-4 my-2 rounded-xl bg-destructive/10 border border-destructive/20 p-2.5 text-center text-xs font-medium text-destructive">
          Please select at least 1 person to create a group.
        </div>
      )}

      <div className="flex-1 overflow-y-auto pt-1">
        {searchResultsList}
        {(!searchResults || searchResults.length === 0) && (
          <div className="p-8 text-center text-xs text-muted-foreground">
            {`No users found for "${searchText || ''}"`}
          </div>
        )}
      </div>
    </div>
  );
}

export default CreateGroupStepOne;
