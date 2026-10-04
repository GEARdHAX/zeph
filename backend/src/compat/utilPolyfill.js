// Restores the legacy `util.is*` helpers that Node removed in v23 (and deprecated before that).
//
// `nedb` (the in-memory store behind store.peers / store.rooms: call producers, room bookkeeping) still
// calls util.isDate / util.isArray / util.isRegExp. On a Node version without them it throws inside its
// own async callbacks, which no try/catch around the caller can see, so every call join hung until the
// browser timed out. Hosts that float to the latest Node (Render) hit this; a laptop on Node 22 does not.
//
// Only fills in what is missing, so on older Node versions this changes nothing. Must be required before
// anything that loads nedb (see index.js).
const util = require('util');

const tag = (value) => Object.prototype.toString.call(value);

const legacy = {
  isArray: Array.isArray,
  isBoolean: (v) => typeof v === 'boolean',
  isBuffer: Buffer.isBuffer,
  isDate: (v) => tag(v) === '[object Date]',
  isError: (v) => tag(v) === '[object Error]' || v instanceof Error,
  isFunction: (v) => typeof v === 'function',
  isNull: (v) => v === null,
  isNullOrUndefined: (v) => v === null || v === undefined,
  isNumber: (v) => typeof v === 'number',
  isObject: (v) => v !== null && typeof v === 'object',
  isPrimitive: (v) => v === null || (typeof v !== 'object' && typeof v !== 'function'),
  isRegExp: (v) => tag(v) === '[object RegExp]',
  isString: (v) => typeof v === 'string',
  isSymbol: (v) => typeof v === 'symbol',
  isUndefined: (v) => v === undefined,
};

const installed = [];
Object.entries(legacy).forEach(([name, fn]) => {
  if (typeof util[name] !== 'function') {
    util[name] = fn;
    installed.push(name);
  }
});

module.exports = { installed };
