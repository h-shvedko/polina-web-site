'use strict';
// Firefox and WebKit for tests/browser/engines.test.js. Their Linux builds need system libraries that a developer
// machine often lacks, so they run in Playwright's Docker image of the installed Playwright version
// (mcr.microsoft.com/playwright:v<version>-noble): the container runs `playwright run-server` on the host network
// with this checkout's node_modules mounted read-only, the tests connect to it, and the browsers load the site from
// the test server on 127.0.0.1. The container stops when the tests end (at the latest after 30 minutes).
// skipReason() says why the tests cannot run here (no Linux, no Docker, image not pulled).
//
// Env: PLAYWRIGHT_IMAGE  Docker image (default mcr.microsoft.com/playwright:v<installed version>-noble)

const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const playwright = require('playwright');
const S = require('./site');

const VERSION = require('playwright/package.json').version;
const IMAGE = process.env.PLAYWRIGHT_IMAGE || `mcr.microsoft.com/playwright:v${VERSION}-noble`;
const NODE_MODULES = path.join(S.ROOT, 'node_modules');
const ENGINES = ['firefox', 'webkit'];

function docker(args, timeout = 60000) {
  return spawnSync('docker', args, { encoding: 'utf8', timeout });
}

/** Why Firefox and WebKit cannot run here, or null. */
function skipReason() {
  if (process.platform !== 'linux') return `the Playwright Docker image needs host networking (Linux); Firefox and WebKit tests skipped on ${process.platform}`;
  const v = docker(['version', '--format', '{{.Server.Version}}'], 30000);
  if (v.error || v.status !== 0) return `Docker is not available (${v.error ? v.error.code || v.error.message : (v.stderr || '').trim().split('\n')[0]}); Firefox and WebKit tests skipped`;
  const img = docker(['image', 'inspect', '--format', '{{.Id}}', IMAGE], 30000);
  if (img.status !== 0) return `Docker image ${IMAGE} is not present (run: docker pull ${IMAGE}); Firefox and WebKit tests skipped`;
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Start `playwright run-server` in the Docker image. Returns { image, connect(engine), stop() }; connect() starts
 * a new browser of that engine in the container. A port taken in the meantime by another program: next free port.
 */
async function startRemote() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await startRemoteOnce(await freePort());
    } catch (e) {
      if (attempt >= 3 || !/EADDRINUSE/.test(e.message)) throw e;
    }
  }
}

async function startRemoteOnce(port) {
  const name = `polina-engines-${process.pid}-${port}`;
  const args = ['run', '--rm', '--init', '--name', name, '--network', 'host', '--ipc', 'host',
    '--user', `${process.getuid()}:${process.getgid()}`, '-e', 'HOME=/tmp', '-e', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
    '-v', `${NODE_MODULES}:${NODE_MODULES}:ro`, IMAGE,
    'timeout', '1800', 'node', path.join(NODE_MODULES, 'playwright', 'cli.js'), 'run-server', '--host', '127.0.0.1', '--port', String(port)];
  const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  let exited = false;
  const exit = new Promise((resolve) => proc.on('close', () => { exited = true; resolve(); }));
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const stop = async () => {
    if (!exited) docker(['rm', '-f', name], 30000);
    await Promise.race([exit, new Promise((r) => setTimeout(r, 15000))]);
  };
  const started = Date.now();
  while (!/Listening on ws:\/\//.test(log)) {
    if (exited || Date.now() - started > 90000) {
      await stop();
      throw new Error(`playwright run-server did not start in ${IMAGE}:\n${log.slice(0, 2000)}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const endpoint = `ws://127.0.0.1:${port}/`;
  return {
    image: IMAGE,
    connect: (engine) => playwright[engine].connect(endpoint, { timeout: 60000 }),
    stop,
  };
}

module.exports = { IMAGE, ENGINES, skipReason, startRemote };
