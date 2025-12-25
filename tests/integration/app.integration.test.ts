import { spawn, ChildProcess } from 'child_process';
// Node 18+ provides a global `fetch`. Use the global instead of adding node-fetch.
import path from 'path';

const ROOT = path.resolve(__dirname, '../../');
const SERVER_CMD = 'node';
const SERVER_ARGS = ['-r', 'ts-node/register', 'src/server.ts'];

function waitForHealth(url: string, timeout = 30000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      fetch(url).then((r: any) => {
        if (r.ok) return resolve();
        if (Date.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(poll, 500);
      }).catch(() => {
        if (Date.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(poll, 500);
      });
    })();
  });
}

describe('Integration: server endpoints', () => {
  let proc: ChildProcess | null = null;
  const PORT = '3002'; // Use different port
  const HEALTH_URL = `http://localhost:${PORT}/health`;

  beforeAll(async () => {
    // start server using ts-node so we don't require a build step in dev
    proc = spawn(SERVER_CMD, SERVER_ARGS, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'test', PORT } });

    proc.stdout && proc.stdout.on('data', (d) => process.stdout.write(d));
    proc.stderr && proc.stderr.on('data', (d) => process.stderr.write(d));

    await waitForHealth(HEALTH_URL, 20000);
  }, 30000);

  afterAll(() => {
    if (proc && !proc.killed) {
      proc.kill();
    }
  });

  test('GET /health returns healthy JSON', async () => {
    const res = await fetch(HEALTH_URL);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status', 'healthy');
    expect(body).toHaveProperty('pod');
  });

  test('GET /stress-stream returns event-stream headers', async () => {
    const res = await fetch(`http://localhost:${PORT}/stress-stream`);
    expect(res.status).toBe(200);
    const type = res.headers.get('content-type') || '';
    expect(type).toMatch(/text\/event-stream/);
  });

  test('POST /generate-load responds 202', async () => {
    const res = await fetch(`http://localhost:${PORT}/generate-load`, { method: 'POST' });
    expect([200,202]).toContain(res.status);
    const j = await res.json();
    expect(j).toHaveProperty('status');
  });

});
