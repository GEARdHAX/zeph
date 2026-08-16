import { useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { postCreate, postUpdate, postDelete } from '../../../actions/admin';

function FormField({ id, label, type, value, onChange, required, error }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} required={required} value={value} onChange={onChange} />
      {error && <div className="text-[13px] text-destructive">{error}</div>}
    </div>
  );
}

function Popup({ onClose, type, user }) {
  const [firstName, setFirstName] = useState(user ? user.firstName : '');
  const [lastName, setLastName] = useState(user ? user.lastName : '');
  const [email, setEmail] = useState(user ? user.email : '');
  const [username, setUsername] = useState(user ? user.username : '');
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [errors, setErrors] = useState(null);

  const okToast = (content) => toast.success(content);
  const errorToast = (content) => toast.error(content);

  const getTitle = () => {
    switch (type) {
      case 'create':
        return 'Create user';
      case 'edit':
        return `Edit ${user.username.substr(0, 16)}${user.username.length > 16 ? '...' : ''}`;
      default:
        return `Delete ${user.username.substr(0, 16)}${user.username.length > 16 ? '...' : ''}`;
    }
  };

  const createUser = async (e) => {
    e.preventDefault();
    try {
      await postCreate({
        username,
        email,
        password,
        repeatPassword,
        firstName,
        lastName,
      });
      okToast(`User ${username} has been created`);
      onClose(true);
    } catch (err) {
      if (err && err.response) setErrors(err.response.data);
      errorToast(`Failed to create user ${username}`);
    }
  };

  const updateUser = async (e) => {
    e.preventDefault();
    try {
      await postUpdate({
        username,
        email,
        password,
        repeatPassword,
        firstName,
        lastName,
        user,
      });
      okToast(`User ${username} has been edited`);
      onClose(true);
    } catch (err) {
      if (err && err.response) setErrors(err.response.data);
      errorToast(`Failed to edit user ${username}`);
    }
  };

  const deleteUser = async (deleteEmail, deleteUsername) => {
    try {
      await postDelete({ email: deleteEmail, username: deleteUsername });
      okToast(`User ${deleteUsername} has been deleted`);
      onClose(true);
    } catch (err) {
      errorToast(`Failed to delete user ${deleteUsername}`);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>

        {['create', 'edit'].includes(type) && (
          <form className="flex flex-col gap-3" onSubmit={(e) => (type === 'edit' ? updateUser(e) : createUser(e))}>
            <FormField
              id="username"
              label="Username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              error={errors && errors.username}
            />
            <FormField
              id="email"
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors && errors.email}
            />
            <FormField
              id="firstName"
              label="First Name"
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              error={errors && errors.firstName}
            />
            <FormField
              id="lastName"
              label="Last Name"
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              error={errors && errors.lastName}
            />
            <FormField
              id="password"
              label="Password"
              type="password"
              required={type === 'create'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors && errors.password}
            />
            <FormField
              id="repeatPassword"
              label="Repeat Password"
              type="password"
              required={type === 'create'}
              value={repeatPassword}
              onChange={(e) => setRepeatPassword(e.target.value)}
              error={errors && errors.repeatPassword}
            />
            <Button type="submit">{`${type === 'edit' ? 'Update' : 'Create'} User`}</Button>
            <Button type="button" variant="secondary" onClick={() => onClose()}>
              Cancel
            </Button>
            {type === 'edit' && (
              <div className="text-center text-[13px] text-muted-foreground">
                Leave password blank if you don not want to change it.
              </div>
            )}
          </form>
        )}

        {type === 'delete' && (
          <div className="flex flex-col items-center gap-3">
            <div className="text-center">{`Are you sure you want to delete user @${user && user.username}?`}</div>
            <Button variant="destructive" className="w-full" onClick={() => deleteUser(user.email, user.username)}>
              Delete User
            </Button>
            <Button type="button" variant="secondary" className="w-full" onClick={() => onClose()}>
              Cancel
            </Button>
            <div className="text-center text-[13px] text-muted-foreground">
              Messages sent by the user will not be deleted. A deleted user can not be recovered.
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default Popup;
