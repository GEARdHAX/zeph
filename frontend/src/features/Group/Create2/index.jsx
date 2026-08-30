import {
  useRef, useState, lazy, Suspense,
} from 'react';
import { useGlobal } from 'reactn';
import {
  Pencil, Users, Check, ArrowRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TopBar from '../components/TopBar';
import Config from '../../../config';
import upload from '../../../actions/uploadImage';
import createGroup from '../../../actions/createGroup';
import { validateFile } from '../../../lib/mediaPolicy';
import LazyFallback from '../../../components/LazyFallback';

// Lazy-loaded so react-easy-crop is only fetched the first time a user
// actually picks a group icon, same as the chat composer's editor.
const ImageEditorModal = lazy(() => import('../../Conversation/components/ImageEditorModal'));

function GroupPicture({ picture, title }) {
  if (picture) {
    return (
      <img
        src={`${Config.url || ''}/api/images/${picture.shieldedID}/256`}
        alt="Group Picture"
        className="h-[120px] w-[120px] rounded-full object-cover border border-white/10"
      />
    );
  }
  return (
    <div className="flex h-[120px] w-[120px] items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-rose-700 text-4xl font-extrabold text-white border border-white/10 shadow-lg">
      {title && title.length > 0 ? title.substr(0, 1).toUpperCase() : <Users className="h-10 w-10 text-white" />}
    </div>
  );
}

function CreateGroupStepTwo() {
  const setPanel = useGlobal('panel')[1];
  const [newGroupUsers] = useGlobal('newGroupUsers');
  const fileInput = useRef(null);
  const [title, setTitle] = useGlobal('groupTitle');
  const [error, setError] = useState(false);
  const [groupPicture, setGroupPicture] = useGlobal('groupPicture');
  const [loading, setLoading] = useState(false);
  const [editingFile, setEditingFile] = useState(null);

  const navigate = useNavigate();

  const changePicture = async (image) => {
    try {
      const picture = await upload(image, null, () => {}, 'square');
      setGroupPicture(picture.data.image);
    } catch (err) {
      console.error(err);
    }
  };

  const selectPicture = (file) => {
    if (!file) return;
    const { valid, category, error: validationError } = validateFile(file);
    if (!valid || category !== 'image') {
      toast.error(validationError || `${file.name}: unsupported image type.`);
      return;
    }
    setEditingFile(file);
  };

  const create = async (e) => {
    e.preventDefault();
    if (!title || title.trim().length === 0) {
      setError(true);
      return;
    }
    setError(false);
    setLoading(true);
    try {
      const res = await createGroup({ people: newGroupUsers, picture: groupPicture, title });
      const room = res.data;
      setPanel('standard');
      navigate(`/room/${room._id}`, { replace: true });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-1 flex-col border-r border-border/60 bg-card text-foreground sm:w-full md:max-w-[320px] md:min-w-[320px] lg:max-w-[360px] lg:min-w-[360px]">
      <TopBar back={() => setPanel('createGroup')} />

      <form onSubmit={create} className="flex flex-col flex-1 justify-between p-6">
        <div className="flex flex-col items-center">
          <input
            className="hidden"
            type="file"
            ref={fileInput}
            accept="image/*"
            onChange={(e) => {
              selectPicture(e.target.files[0]);
              e.target.value = '';
            }}
          />

          {/* Group Picture selector */}
          <div
            className="group relative my-4 cursor-pointer"
            onClick={() => fileInput?.current?.click()}
          >
            <GroupPicture picture={groupPicture} title={title} />
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <Pencil className="h-6 w-6" />
            </div>
          </div>
          <span className="text-xs text-muted-foreground mb-6">Click to upload group icon</span>

          {/* Group Name Input */}
          <div className="w-full">
            <label className="block text-xs font-semibold text-foreground mb-1.5">Group Name</label>
            <Input
              className="h-11 rounded-xl border border-input bg-background/50 px-3.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
              type="text"
              placeholder="e.g. Design Team, Family, Book Club..."
              value={title || ''}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            {error && (
              <span className="mt-1.5 block text-xs font-medium text-destructive">
                Please enter a name for the group!
              </span>
            )}
          </div>
        </div>

        {/* Submit Action */}
        <Button
          type="submit"
          disabled={loading}
          className="mt-6 w-full gap-2 rounded-xl bg-primary text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          <span>{loading ? 'Creating Group...' : 'Complete & Create Group'}</span>
          <Check className="h-4 w-4" />
        </Button>
      </form>

      {editingFile && (
        <Suspense fallback={<LazyFallback />}>
          <ImageEditorModal
            file={editingFile}
            aspect={1}
            onCancel={() => setEditingFile(null)}
            onDone={(editedFile) => {
              setEditingFile(null);
              changePicture(editedFile);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

export default CreateGroupStepTwo;
