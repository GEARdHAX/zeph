// react-router-dom's useNavigate() only works inside a component rendered
// under <Router>, but initIO.js is a plain action (no component tree) that
// needs to navigate when a new-message toast is clicked. NavigateRegistrar
// (rendered once, inside <Router>, in App.jsx) stores the real navigate
// function here so any non-component code can call it.
let navigateRef = null;

export const registerNavigate = (navigate) => {
  navigateRef = navigate;
};

export const navigateTo = (path) => {
  if (navigateRef) navigateRef(path);
  else window.location.assign(path);
};
