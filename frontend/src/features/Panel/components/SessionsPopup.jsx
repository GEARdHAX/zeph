import { useEffect, useState } from 'react';
import moment from 'moment';
import { toast } from 'react-toastify';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import getSessions from '../../../actions/getSessions';
import revokeSession from '../../../actions/revokeSession';

function SessionsPopup({ onClose }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    getSessions()
      .then((res) => setSessions(res.data.sessions))
      .catch(() => toast.error('Could not load active sessions.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const revoke = async (id) => {
    try {
      await revokeSession(id);
      setSessions(sessions.filter((s) => s.id !== id));
    } catch (e) {
      toast.error('Could not revoke that session.');
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Active Sessions</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[400px] flex-col gap-2 overflow-y-auto">
          {loading && <div className="text-center text-sm text-muted-foreground">Loading…</div>}
          {!loading && sessions.length === 0 && (
            <div className="text-center text-sm text-muted-foreground">No active sessions.</div>
          )}
          {sessions.map((session) => (
            <div key={session.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {session.userAgent || 'Unknown device'}
                  {session.isCurrent && <span className="ml-2 text-xs text-muted-foreground">(this device)</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {`Last active ${moment(session.lastSeenAt).fromNow()}`}
                </div>
              </div>
              {!session.isCurrent && (
                <Button variant="destructive" size="sm" onClick={() => revoke(session.id)}>
                  Log out
                </Button>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SessionsPopup;
