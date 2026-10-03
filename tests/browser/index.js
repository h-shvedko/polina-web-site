'use strict';
// Entry point for `node --test tests/<group>/` (the npm scripts pass the directory). Node 22 does not
// search a directory argument for test files; it runs the directory as a module, which loads this file.
// This file then loads every *.test.js next to it, so the whole group runs in one process.
// A glob such as `node --test "tests/<group>/*.test.js"` does not match this file and runs each test
// file in its own process instead; both ways run the same tests.
const fs = require('node:fs');
const path = require('node:path');

for (const name of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).sort()) {
  require(path.join(__dirname, name));
}
