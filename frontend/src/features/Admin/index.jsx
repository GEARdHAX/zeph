import { useEffect, useRef, useState } from 'react';
import { useGlobal } from 'reactn';
import { useNavigate } from 'react-router-dom';
import DataTable from 'react-data-table-component';
import {
  Search, Plus, UserCheck, Shield, Edit2, Trash2, ArrowLeft, ShieldAlert, Radar, Cpu, Network,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import useTheme from '../../lib/useTheme';
import search from '../../actions/search';
import Popup from './components/Popup';
import Config from '../../config';

function Admin() {
  const navigate = useNavigate();
  const setOver = useGlobal('over')[1];
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const searchInput = useRef();
  const setSearchResults = useGlobal('searchResults')[1];
  const [searchText, setSearch] = useGlobal('search');
  const [popup, setPopup] = useState(null);
  const [user, setUser] = useState(null);
  const { theme } = useTheme();

  const isDark = theme === 'dark';

  const onChange = (e) => {
    setSearch(e.target.value);
    search(e.target.value)
      .then((res) => setSearchResults(res.data.users))
      .catch((err) => console.log(err));
  };

  // No loading state previously existed here at all — a search-box
  // keystroke re-fetches this whole (up to 10,000-row) table with no
  // feedback, so on a slow connection the table just sits stale/unchanged
  // until the response lands, indistinguishable from the keystroke having
  // done nothing. progressPending below is react-data-table-component's own
  // built-in prop for this — no separate skeleton/spinner needed.
  useEffect(() => {
    setUsersLoading(true);
    search(searchText || null, 10000)
      .then((res) => {
        setUsers(res.data.users || []);
      })
      .catch((err) => console.log(err))
      .finally(() => setUsersLoading(false));
  }, [searchText]);

  const back = () => setOver(false);

  const columns = [
    {
      name: 'User',
      selector: (row) => `${row.firstName} ${row.lastName}`,
      sortable: true,
      grow: 1.5,
      cell: (row) => (
        <div className="flex items-center gap-3 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-rose-700 text-xs font-bold text-white shadow-sm">
            {`${(row.firstName || 'U').charAt(0)}${(row.lastName || '').charAt(0)}`.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-foreground text-sm truncate">
              {row.firstName}
              {' '}
              {row.lastName}
            </div>
            <div className="text-xs text-muted-foreground truncate">{`@${row.username}`}</div>
          </div>
        </div>
      ),
    },
    {
      name: 'Email',
      selector: (row) => row.email,
      sortable: true,
      grow: 1.5,
      cell: (row) => <span className="text-xs text-muted-foreground truncate">{row.email}</span>,
    },
    {
      name: 'Role',
      selector: (row) => row.level || 'User',
      sortable: true,
      cell: (row) => (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            row.level === 'root' || row.level === 'admin'
              ? 'bg-primary/15 text-primary border border-primary/20'
              : 'bg-muted text-muted-foreground border border-border'
          }`}
        >
          <Shield className="h-3 w-3" />
          {row.level === 'root' || row.level === 'admin' ? 'Admin' : 'Member'}
        </span>
      ),
    },
    {
      name: 'Actions',
      sortable: false,
      right: true,
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={() => {
              setUser(row);
              setPopup('edit');
            }}
          >
            <Edit2 className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              setUser(row);
              setPopup('delete');
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      ),
    },
  ];

  const customStyles = {
    table: {
      style: {
        backgroundColor: 'transparent',
      },
    },
    header: {
      style: {
        backgroundColor: 'transparent',
        color: isDark ? '#f4f4f5' : '#09090b',
        fontSize: '18px',
        fontWeight: '700',
        padding: '0px',
      },
    },
    headRow: {
      style: {
        backgroundColor: isDark ? '#121215' : '#f4f4f5',
        borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        borderRadius: '12px',
        marginBottom: '6px',
        minHeight: '44px',
      },
    },
    headCells: {
      style: {
        color: isDark ? '#a1a1aa' : '#71717a',
        fontSize: '12px',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      },
    },
    rows: {
      style: {
        backgroundColor: 'transparent',
        borderBottomColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
        '&:hover': {
          backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
        },
      },
    },
    pagination: {
      style: {
        backgroundColor: 'transparent',
        color: isDark ? '#a1a1aa' : '#71717a',
        borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
      },
      pageButtonsStyle: {
        fill: isDark ? '#a1a1aa' : '#71717a',
        '&:disabled': {
          fill: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
        },
        '&:hover:not(:disabled)': {
          backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
        },
      },
    },
  };

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground overflow-y-auto">
      {/* Top Header */}
      <div className="flex h-16 w-full shrink-0 items-center justify-between border-b border-border/60 bg-card px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="sm:hidden h-8 w-8" onClick={back}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-bold text-foreground">Admin Console</h1>
            <p className="text-xs text-muted-foreground">Manage users, access permissions, and roles</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 rounded-xl text-xs font-semibold"
            onClick={() => navigate('/admin/security-events')}
          >
            <ShieldAlert className="h-4 w-4" />
            Security Events
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 rounded-xl text-xs font-semibold"
            onClick={() => navigate('/admin/threat-intelligence')}
          >
            <Radar className="h-4 w-4" />
            Threat Intelligence
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 rounded-xl text-xs font-semibold"
            onClick={() => navigate('/admin/sensors')}
          >
            <Cpu className="h-4 w-4" />
            Sensors
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 rounded-xl text-xs font-semibold"
            onClick={() => navigate('/admin/network-intelligence')}
          >
            <Network className="h-4 w-4" />
            Network
          </Button>
          <Button
            size="sm"
            className="gap-2 rounded-xl bg-primary text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
            onClick={() => setPopup('create')}
          >
            <Plus className="h-4 w-4" />
            Add User
          </Button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 p-6 max-w-6xl w-full mx-auto">
        {/* Search Toolbar */}
        <div className="mb-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-10 w-full rounded-xl border border-input bg-card/60 pl-10 pr-4 text-xs font-medium text-foreground placeholder:text-muted-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="Filter users by name, username, or email..."
              ref={searchInput}
              value={searchText || ''}
              onChange={onChange}
            />
          </div>

          <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 self-end sm:self-center">
            <UserCheck className="h-4 w-4 text-primary" />
            <span>
              Total Users:
              {' '}
              <strong className="text-foreground">{users.length}</strong>
            </span>
          </div>
        </div>

        {/* Data Table */}
        <div className="rounded-2xl border border-border/70 bg-card/40 p-4 shadow-sm backdrop-blur-sm">
          <DataTable
            columns={columns}
            data={users}
            pagination
            responsive
            customStyles={customStyles}
            theme={isDark ? 'dark' : 'light'}
            noDataComponent={<div className="p-10 text-center text-xs text-muted-foreground">No users found.</div>}
            progressPending={usersLoading}
            progressComponent={<div className="p-10 text-center text-xs text-muted-foreground">Loading…</div>}
          />
        </div>
      </div>

      {popup && (
        <Popup
          onClose={(refresh) => {
            setPopup(null);
            if (refresh) {
              search(searchText || null, 10000).then((res) => {
                setUsers(res.data.users || []);
              });
            }
          }}
          type={popup}
          user={user}
        />
      )}
    </div>
  );
}

export default Admin;
