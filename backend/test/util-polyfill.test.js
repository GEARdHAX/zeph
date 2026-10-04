const { execFileSync } = require('child_process');
const path = require('path');

// Node 23+ removed util.isDate & co., which nedb still calls (render.com runs a newer Node than a laptop on
// 22 and every call join hung on "util.isDate is not a function"). Each case runs in a fresh process in
// which those helpers are deleted first, so it proves the behaviour on ANY Node version.
const run = (withPolyfill) => {
  const code = `
    const util = require('util');
    ['isArray','isDate','isRegExp','isString','isObject'].forEach((n) => { delete util[n]; });
    ${withPolyfill ? `require(${JSON.stringify(path.resolve(__dirname, '../src/compat/utilPolyfill'))});` : ''}
    const Datastore = require('nedb');
    const db = new Datastore();
    db.insert({ type: 'producer', roomID: 'r1', when: new Date() }, (err) => {
      if (err) { console.log('insert-error:' + err.message); process.exit(0); }
      db.find({ type: 'producer', roomID: 'r1' }, (e, docs) => console.log('found:' + docs.length));
    });
  `;
  try {
    return execFileSync(process.execPath, ['-e', code], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return `crashed:${(err.stderr || err.message).toString().split('\n').find((l) => /TypeError|Error/.test(l)) || 'unknown'}`;
  }
};

describe('util.is* compatibility shim', () => {
  it('without the shim, nedb fails when Node has removed util.isDate (the Render bug)', () => {
    expect(run(false)).toMatch(/crashed:.*is not a function|insert-error/);
  });

  it('with the shim, nedb inserts and queries normally', () => {
    expect(run(true)).toBe('found:1');
  });

  it('does not overwrite helpers that exist', () => {
    const util = require('util');
    const before = util.isArray;
    jest.isolateModules(() => require('../src/compat/utilPolyfill'));
    expect(util.isArray).toBe(before);
  });
});
