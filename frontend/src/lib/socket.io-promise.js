// Adds support for Promise to socket.io-client.
// Without a timeout, a request whose server-side handler throws before
// calling back (or a dropped connection) hangs the caller's await forever,
// with zero error surfaced to the user — this is what made mediasoup call
// setup silently freeze instead of failing visibly.
const REQUEST_TIMEOUT_MS = 15000;

// eslint-disable-next-line func-names
export default function (socket) {
  return function request(type, data = {}) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for a response to "${type}"`));
      }, REQUEST_TIMEOUT_MS);

      socket.emit(type, data, (response) => {
        clearTimeout(timeout);
        if (response && response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  };
}
