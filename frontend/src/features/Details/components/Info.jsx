import { useGlobal } from 'reactn';
import logo from '../../../assets/logo.png';
import Config from '../../../config';

function Info() {
  const version = useGlobal('version')[0];

  return (
    <div className="flex h-full w-full flex-col justify-between overflow-y-hidden bg-background">
      <div className="flex flex-col items-center">
        <div className="-mb-10 px-16 pb-5 pt-14">
          <img src={logo} alt="Picture" className="w-20" />
        </div>
        <div className="px-8 py-8 text-center text-sm text-muted-foreground">
          {`Welcome to ${Config.appName || 'Chitcx'}!`}
          <br />
          <br />
          {`${Config.appName || 'Chitcx'} is a messaging app that enables real-time messaging, audio and video calls, groups and conferencing.`}
        </div>
      </div>
      <div className="px-8 py-8 text-center text-sm text-muted-foreground">
        {`Copyright © ${Config.brand || 'Chitcx'}`}
        <br />
        {`v${version}`}
      </div>
    </div>
  );
}

export default Info;
