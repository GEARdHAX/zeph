import logo from '../../../assets/logo.png';
import Config from '../../../config';

function Logo() {
  return (
    <div className="mb-4 flex flex-col items-center gap-2 px-[95px] pb-2.5 text-center">
      <img src={logo} alt="Logo" className="h-16 w-16" />
      <h1 className="text-2xl font-bold">{Config.appName}</h1>
    </div>
  );
}

export default Logo;
