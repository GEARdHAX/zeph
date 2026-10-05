import { useMutation, QueryClient } from '@tanstack/react-query';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import Actions from '../constants/Actions';
import deleteMessage from '../actions/deleteMessage';

// Mutations only: no queries live here, so a bare client (passed to useMutation directly, no provider needed) is enough.
export const queryClient = new QueryClient();

// Optimistic delete. The message disappears (or becomes the "This message was deleted" tombstone) the instant the user
// confirms; a 200 keeps it that way, any failure puts the original message back and says why.
export default function useDeleteMessage(roomID, message) {
  const dispatch = useDispatch();

  return useMutation(
    {
      mutationFn: ({ forEveryone }) => deleteMessage({ roomID, messageID: message._id, forEveryone }),
      onMutate: ({ forEveryone }) => {
        dispatch({ type: Actions.MESSAGE_DELETE, messageID: message._id, forEveryone });
        return { snapshot: message };
      },
      onSuccess: (res, { forEveryone }) => {
        // Settle the optimistic timestamp on the server's own.
        if (forEveryone && res.data?.deletedAt) {
          dispatch({ type: Actions.MESSAGE_DELETE, messageID: message._id, forEveryone, deletedAt: res.data.deletedAt });
        }
      },
      onError: (err, vars, context) => {
        if (context?.snapshot) dispatch({ type: Actions.MESSAGE_RESTORE, message: context.snapshot });
        toast.error(
          err?.response?.data?.reason === 'deletion_window_expired'
            ? 'Too late to delete this for everyone.'
            : 'Could not delete message. It has been restored.',
        );
      },
    },
    queryClient,
  );
}
