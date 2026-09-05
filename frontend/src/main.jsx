import React from 'react';
import ReactDOM from 'react-dom/client';
// Variable font — one import covers the full weight range (400 body copy
// through the heavy weight the "zeph." wordmark uses), so unlike the old
// per-weight Space Grotesk imports there's nothing else to add here. The
// default (weight-axis-only) import, not full.css — nothing in the app
// currently uses the opsz/wdth/GRAD/ROND axes, so the much larger full.css
// payload (every axis + every unicode subset) would be pure bloat.
import '@fontsource-variable/google-sans-flex';
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

  // Notify index.html that React is ready so it smoothly dismisses the initial loader
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('zeph:ready'));
  }

  // If you want your app to work offline and load faster, you can change
  // unregister() to register() below. Note this comes with some pitfalls.
  // Learn more about service workers: https://bit.ly/CRA-PWA
  serviceWorker.unregister();
});
