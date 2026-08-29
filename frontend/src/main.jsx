import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/space-grotesk/300.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
// full.css (not the default wght-only import) — ZephSpinner's wordmark
// needs the opsz/wdth/GRAD/ROND axes too, matching its own
// font-variation-settings block. See components/ui/ZephSpinner.jsx.
import '@fontsource-variable/google-sans-flex/full.css';
import './index.css';
import { Provider } from 'react-redux';
import App from './App';
import * as serviceWorker from './serviceWorker';
import init from './init';
import store from './store';

init().then(() => {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
    <React.StrictMode>
      <Provider store={store}>
        <App />
      </Provider>
    </React.StrictMode>,
  );

  // If you want your app to work offline and load faster, you can change
  // unregister() to register() below. Note this comes with some pitfalls.
  // Learn more about service workers: https://bit.ly/CRA-PWA
  serviceWorker.unregister();
});
