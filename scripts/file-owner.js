'use strict';
/*
 * file-owner.js: generated files keep the owner of the repository when a build runs as root.
 *
 * The dev container of docker-compose.yaml runs `npm install && npm run server-start` as root on a bind mount of
 * the checkout. Files and folders that build-site.js and images.js create there (and the folders gulp.dest
 * creates) would belong to root, and on the host `npm run build:site`, `git pull` and `git checkout` then fail
 * with EACCES. gulp.dest (vinyl-fs) keeps the owner of the files it copies; this does the same for the rest.
 *
 *   matchOwner(root, targets)  only when the process runs as root and `root` belongs to another user: give every
 *                              target (a file, or a folder with everything below it) the uid/gid of `root`.
 *                              Symbolic links are changed themselves and never followed. Returns the number of
 *                              changed entries.
 *
 * Already affected checkouts are repaired once on the host: sudo chown -R "$(id -u):$(id -g)" app src/img
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {string} root  folder whose owner the targets get (the repository root)
 * @param {string[]} targets  files or folders (walked recursively)
 * @param {object} [io]  injectable for tests: getuid(), lstat(p), lchown(p, uid, gid), readdir(p)
 */
function matchOwner(root, targets, io = {}) {
  const getuid = io.getuid || (typeof process.getuid === 'function' ? () => process.getuid() : null);
  if (!getuid || getuid() !== 0) return 0;
  const lstat = io.lstat || ((p) => fs.lstatSync(p));
  const lchown = io.lchown || ((p, uid, gid) => fs.lchownSync(p, uid, gid));
  const readdir = io.readdir || ((p) => fs.readdirSync(p));
  const ref = lstat(root);
  if (ref.uid === 0) return 0; // a checkout that belongs to root: nothing to restore
  let changed = 0;
  const visit = (p) => {
    let st;
    try {
      st = lstat(p);
    } catch {
      return; // removed meanwhile
    }
    if (st.uid !== ref.uid || st.gid !== ref.gid) {
      lchown(p, ref.uid, ref.gid);
      changed++;
    }
    if (st.isDirectory()) for (const name of readdir(p)) visit(path.join(p, name));
  };
  for (const target of targets) visit(target);
  return changed;
}

module.exports = { matchOwner };
