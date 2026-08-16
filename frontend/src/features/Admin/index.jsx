import { useEffect, useRef, useState } from 'react';
import { useGlobal } from 'reactn';
import DataTable from 'react-data-table-component';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TopBar from './components/TopBar';
import BottomBar from './components/BottomBar';
import search from '../../actions/search';
import Popup from './components/Popup';

function Admin() {
  const setOver = useGlobal('over')[1];
  const [users, setUsers] = useState([]);
  const searchInput = useRef();
  const setSearchResults = useGlobal('searchResults')[1];
  const [searchText, setSearch] = useGlobal('search');
  const [popup, setPopup] = useState(null);
  const [user, setUser] = useState(null);

  const onChange = (e) => {
    setSearch(e.target.value);
    search(e.target.value)
      .then((res) => setSearchResults(res.data.users))
      .catch((err) => console.log(err));
  };

  useEffect(() => {
    search(searchText || null, 10000).then((res) => {
      setUsers(res.data.users);
    });
  }, [searchText]);

  const back = () => setOver(false);

  const columns = [
    { name: 'First Name', selector: (row) => row.firstName, sortable: true },
    { name: 'Last Name', selector: (row) => row.lastName, sortable: true },
    { name: 'Email', selector: (row) => row.email, sortable: true },
    { name: 'Username', selector: (row) => row.username, sortable: true },
    {
      name: 'Actions',
      sortable: false,
      cell: (row) => (
        <div className="flex gap-3">
          <button
            type="button"
            className="text-blue-700 hover:underline"
            onClick={() => {
              setUser(row);
              setPopup('edit');
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="text-destructive hover:underline"
            onClick={() => {
              setUser(row);
              setPopup('delete');
            }}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const data = users.map((u) => ({
    id: u._id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    username: u.username,
  }));

  return (
    <div className="flex h-full flex-col">
      <TopBar back={back} />
      <div className="flex items-center gap-2 bg-muted px-4 py-2">
        <Search className="h-4 w-4 cursor-pointer text-muted-foreground" onClick={() => searchInput.current.focus()} />
        <input
          className="w-full rounded-full border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="Search"
          ref={searchInput}
          onChange={onChange}
        />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="h-full w-full overflow-y-auto bg-background">
          <div className="relative h-0 w-full text-right">
            <Button className="m-2.5" onClick={() => setPopup('create')}>
              Create
            </Button>
          </div>
          <DataTable
            title="Admin - Users"
            columns={columns}
            data={data}
            defaultSortField="title"
            pagination
            paginationPerPage={20}
          />
        </div>
      </div>
      <BottomBar />
      {popup && (
        <Popup
          onClose={(shouldUpdate) => {
            if (shouldUpdate) {
              search(searchText || null, 10000).then((res) => {
                setUsers(res.data.users);
              });
            }
            setPopup(null);
          }}
          user={user}
          type={popup}
        />
      )}
    </div>
  );
}

export default Admin;
