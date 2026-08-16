import moment from 'moment';
import emojiRegex from 'emoji-regex';
import { useGlobal } from 'reactn';
import ReactImageAppear from 'react-image-appear';
import { DownloadCloud } from 'lucide-react';
import striptags from 'striptags';
import { cn } from '@/lib/utils';
import Config from '../../../config';

function Message({ message, previous, next, onOpen }) {
  const { content, date } = message;
  let { author } = message;

  const user = useGlobal('user')[0];

  if (!author) author = { firstName: 'Deleted', lastName: 'User' };
  if (previous && !previous.author) previous.author = { firstName: 'Deleted', lastName: 'User' };
  if (next && !next.author) next.author = { firstName: 'Deleted', lastName: 'User' };

  const isMine = user.id === author._id;

  let attachPrevious = false;
  let attachNext = false;

  if (
    previous &&
    Math.abs(moment(previous.date).diff(moment(date), 'minutes')) < 3 &&
    author._id === previous.author._id
  )
    attachPrevious = true;
  if (next && Math.abs(moment(next.date).diff(moment(date), 'minutes')) < 3 && author._id === next.author._id)
    attachNext = true;

  function Picture({ user: pictureUser }) {
    if (pictureUser.picture) {
      return (
        <img
          src={`${Config.url || ''}/api/images/${pictureUser.picture.shieldedID}/256`}
          alt="Picture"
          className="h-[60px] w-[60px] rounded-full object-cover"
        />
      );
    }
    return (
      <div className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-secondary text-xl text-secondary-foreground">
        {pictureUser.firstName.substr(0, 1)}
        {pictureUser.lastName.substr(0, 1)}
      </div>
    );
  }

  function Details({ side }) {
    if (attachNext) return null;
    return (
      <div className={cn('mx-3.5 p-1.5 text-[10px] text-muted-foreground', side === 'right' && 'w-[270px] text-right')}>
        {moment(date).format('MMM DD - h:mm A')}
      </div>
    );
  }

  function PictureOrSpacer() {
    if (attachPrevious) return <div className="h-[60px] w-[60px]" />;
    return (
      <div className="-mb-5">
        <Picture user={author} />
      </div>
    );
  }

  const noEmoji = content.replace(emojiRegex(), '');
  const isOnlyEmoji = !noEmoji.replace(/[\s\n]/gm, '');

  const convertUrls = (text) => {
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/gi;
    return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank">${url}</a>`);
  };

  function Content() {
    switch (message.type) {
      case 'image':
        return (
          <ReactImageAppear
            src={`${Config.url || ''}/api/images/${message.content}/512`}
            animationDuration="0.2s"
            onClick={() => onOpen(message)}
          />
        );
      case 'file':
        return (
          <a
            href={`${Config.url || ''}/api/files/${message.content}`}
            download={message.file ? message.file.name : 'File'}
            className="flex items-center"
          >
            <div>
              <div className="font-bold">{message.file ? message.file.name : 'File'}</div>
              <div className="text-xs">
                {message.file ? `${Math.round((message.file.size / 1024 / 1024) * 10) / 10} MB` : 'Size'}
              </div>
            </div>
            <DownloadCloud className="ml-2.5 h-[18px] w-[27px] min-w-[27px]" />
          </a>
        );
      default:
        return (
          <div
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: convertUrls(striptags(content, ['a', 'strong', 'b', 'i', 'em', 'u', 'br'])),
            }}
          />
        );
    }
  }

  const isImage = message.type === 'image';

  return (
    <div
      className={cn(
        'flex flex-1 flex-row px-[30px] pb-2.5 pt-6',
        isMine && 'flex-row-reverse justify-start',
        attachPrevious && 'pt-0',
        attachNext && 'pb-[3px]',
      )}
    >
      <PictureOrSpacer />
      <div className="flex min-w-[300px] max-w-[30%] flex-col">
        {isImage && (
          <div
            className={cn(
              'relative mx-3.5 -mt-0.5 h-[270px] min-h-[270px] w-[270px] cursor-pointer overflow-hidden rounded-[10px] border',
              isMine && 'text-right',
            )}
          >
            <Content />
          </div>
        )}
        {!isImage && isOnlyEmoji && (
          <div className={cn('relative mx-3.5 -mt-0.5 text-4xl', isMine && 'text-right')}>
            <Content />
          </div>
        )}
        {!isImage && !isOnlyEmoji && (
          <div className="relative">
            {!attachPrevious && (
              <div
                className={cn(
                  'absolute top-0 h-0 w-0 border-b-[15px] border-t-[26px] border-b-transparent',
                  isMine
                    ? 'right-[-10px] rounded-tr-[5px] border-l-[10px] border-r-[15px] border-l-primary border-t-primary border-r-transparent'
                    : 'left-[-10px] rounded-tl-[5px] border-l-[15px] border-r-[10px] border-l-transparent border-r-muted border-t-muted',
                )}
              />
            )}
            <div
              className={cn(
                'relative mx-3.5 break-words rounded-[10px] bg-muted px-4 py-2 text-muted-foreground',
                isMine && 'bg-primary text-primary-foreground',
                attachPrevious && (isMine ? 'rounded-tr-none' : 'rounded-tl-none'),
                attachNext && (isMine ? 'rounded-br-none' : 'rounded-bl-none'),
              )}
            >
              <Content />
            </div>
          </div>
        )}
        <Details side={isMine ? 'right' : 'left'} />
      </div>
    </div>
  );
}

export default Message;
