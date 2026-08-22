import { useMemo, useState } from 'react';
import { useGlobal } from 'reactn';
import { toast } from 'react-toastify';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import updateBio from '../../../actions/updateBio';
import BioText from '../../../components/BioText';

const MAX_WORDS = 150; // must match backend/src/routes/users/update-bio.js's MAX_WORDS
const MAX_CHARS = 1000; // generous ceiling alongside the word limit — see update-bio.js

const countWords = (text) => text.trim().split(/\s+/).filter(Boolean).length;

function EditBioPopup({ onClose }) {
  const [user, setUser] = useGlobal('user');
  const [bio, setBio] = useState(user.bio || '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const wordCount = useMemo(() => countWords(bio), [bio]);
  const overLimit = wordCount > MAX_WORDS || bio.length > MAX_CHARS;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (overLimit) {
      setError(`Keep it to ${MAX_WORDS} words (or ${MAX_CHARS} characters) or fewer.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await updateBio(bio);
      const newUser = { ...user, bio: res.data.user.bio };
      localStorage.setItem('user', JSON.stringify(newUser));
      await setUser(newUser);
      toast.success('Bio updated!');
      onClose();
    } catch (err) {
      const reason = err.response?.data?.reason;
      if (reason === 'bio_too_long') setError(`Keep it to ${MAX_WORDS} words (or ${MAX_CHARS} characters) or fewer.`);
      else setError('Could not update bio. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit bio</DialogTitle>
          <DialogDescription>
            Formatting: **bold**, *italic*, __underline__, ~~strike~~,
            ==highlight==, `code`, [text](https://url), @mention, #hashtag.
            Max
            {' '}
            {MAX_WORDS}
            {' '}
            words.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              rows={5}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell people a bit about yourself... **bold**, *italic*, [link](https://...), @mention, #tag"
            />
            <div className={`text-right text-[11px] ${overLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
              {wordCount}
              {' / '}
              {MAX_WORDS}
              {' words'}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Preview</Label>
            <div className="min-h-16 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
              {bio ? <BioText text={bio} /> : <span className="text-muted-foreground">Nothing to preview yet.</span>}
            </div>
          </div>

          {error && <div className="text-[13px] text-destructive">{error}</div>}

          <Button type="submit" disabled={busy || overLimit}>
            {busy ? 'Saving…' : 'Save Bio'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default EditBioPopup;
