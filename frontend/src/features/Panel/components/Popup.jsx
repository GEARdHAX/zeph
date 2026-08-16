import { useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import changeUserPassword from '../../../actions/changeUserPassword';

function FormField({ id, label, type, value, onChange, required, error }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} required={required} value={value} onChange={onChange} />
      {error && <div className="text-[13px] text-destructive">{error}</div>}
    </div>
  );
}

function ChangePasswordPopup({ onClose }) {
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [errors, setErrors] = useState(null);

  const onChangePassword = async (e) => {
    e.preventDefault();

    if (password !== repeatPassword) {
      setErrors({ repeatPassword: 'repeat must be same as password' });
      return;
    }

    try {
      await changeUserPassword(password);
      onClose();
      toast.success('Password changed!');
    } catch (err) {
      let nextErrors = {};
      if (!err.response || typeof err.response.data !== 'object') nextErrors.generic = 'Could not connect to server.';
      else nextErrors = err.response.data;
      setErrors(nextErrors);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change user password</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={onChangePassword}>
          <FormField
            id="password"
            label="Password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors && errors.password}
          />
          <FormField
            id="repeatPassword"
            label="Repeat Password"
            type="password"
            required
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
            error={errors && errors.repeatPassword}
          />
          <Button type="submit">Change Password</Button>
          <Button type="button" variant="secondary" onClick={() => onClose()}>
            Cancel
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ChangePasswordPopup;
