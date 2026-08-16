import moment from 'moment';
import { useGlobal } from 'reactn';
import Config from '../../../config';

function Copyright({ onShowCredits }) {
  const version = useGlobal('version')[0];
  return (
    <div className="absolute bottom-2 left-1/2 z-10 hidden -translate-x-1/2 text-xs text-white/70 md:block">
      {`© ${moment().year()} ${Config.brand || 'Chitcx'}`}
      {Config.showCredits && (
        <>
          {' - '}
          <button
            type="button"
            className="underline"
            title="Special thanks and open source resources in use"
            onClick={onShowCredits}
          >
            Credits
          </button>
        </>
      )}
      {` - v${version}`}
    </div>
  );
}

export default Copyright;
