import BrandLogo from '../../../components/BrandLogo';
import Config from '../../../config';

function Logo() {
  return (
    <div className="mb-4 flex flex-col items-center gap-2 px-[95px] pb-2.5 text-center">
      <BrandLogo className="h-16 w-16" />
      <h1 className="font-zeph text-2xl font-extrabold">{Config.appName}</h1>
    </div>
  );
}

export default Logo;
