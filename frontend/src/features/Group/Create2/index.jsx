import { useRef, useState } from 'react';
import { useGlobal } from 'reactn';
import { Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TopBar from '../components/TopBar';
import Config from '../../../config';
import upload from '../../../actions/uploadImage';
import createGroup from '../../../actions/createGroup';

function GroupPicture({ picture, title }) {
  if (picture) {
    return (
      <img
        src={`${Config.url || ''}/api/images/${picture.shieldedID}/256`}
        alt="Picture"
        className="h-[150px] w-[150px] rounded-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-[150px] w-[150px] items-center justify-center rounded-full bg-secondary text-5xl text-secondary-foreground">
      {title && title.length > 0 ? title.substr(0, 1) : 'G'}
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

  const navigate = useNavigate();

  const changePicture = async (image) => {
    const picture = await upload(image, null, () => {}, 'square');
    setGroupPicture(picture.data.image);
  };

  const create = async (e) => {
    e.preventDefault();
    if (!title || title.length === 0) {
      setError(true);
      return;
    }
    setError(false);
    const res = await createGroup({ people: newGroupUsers, picture: groupPicture, title });
    const room = res.data;
    setPanel('standard');
    navigate(`/room/${room._id}`, { replace: true });
  };

  return (
    <div className="flex h-full flex-1 flex-col border-r sm:w-full md:max-w-[300px] md:min-w-[300px] lg:max-w-[360px] lg:min-w-[360px]">
      <TopBar back={() => setPanel('createGroup')} />
      <Button className="w-full rounded-none" onClick={create}>
        Create Group
      </Button>
      {error && <div className="bg-muted px-3 py-3 text-center text-sm text-blue-700">Group name required!</div>}
      <input
        className="hidden"
        type="file"
        ref={fileInput}
        accept="image/*"
        onChange={(e) => changePicture(e.target.files[0])}
      />
      <div
        className="group relative left-1/2 mt-4 w-[150px] -translate-x-1/2 cursor-pointer"
        onClick={() => fileInput && fileInput.current && fileInput.current.click()}
      >
        <GroupPicture picture={groupPicture} title={title} />
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 text-white opacity-0 transition-opacity group-hover:bg-black/70 group-hover:opacity-100">
          <Pencil className="h-8 w-8" />
        </div>
      </div>
      <Input
        className="mx-2.5 mb-1.5 mt-4 rounded-full"
        type="text"
        placeholder="Group name..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
    </div>
  );
}

export default CreateGroupStepTwo;
