/**
 * End-to-end integration tests for complete workflows
 */
import { spawn, ChildProcess } from 'child_process';
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

describe.skip('End-to-End Workflow Tests', () => {
  let proc: ChildProcess | null = null;
  const PORT = '3003';
  const BASE_URL = `http://localhost:${PORT}`;
  const HEALTH_URL = `${BASE_URL}/health`;

  beforeAll(async () => {
    proc = spawn(SERVER_CMD, SERVER_ARGS, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test', PORT }
    });

    proc.stdout && proc.stdout.on('data', (d) => process.stdout.write(d));
    proc.stderr && proc.stderr.on('data', (d) => process.stderr.write(d));

    await waitForHealth(HEALTH_URL, 25000);
  }, 35000);

  afterAll(() => {
    if (proc && !proc.killed) {
      proc.kill();
    }
  });

  describe('Complete user workflow', () => {
    test('user visits dashboard and sees UI', async () => {
      const res = await fetch(BASE_URL);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Dashboard');
      expect(html).toContain('Team 22');
    });

    test('user checks application health', async () => {
      const res = await fetch(HEALTH_URL);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('healthy');
    });

    test('user navigates to stress control page', async () => {
      const res = await fetch(`${BASE_URL}/stress`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Stress Control');
    });

    test('user navigates to pods overview', async () => {
      const res = await fetch(`${BASE_URL}/pods`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('html');
    });
  });

  describe('Load testing workflow', () => {
    test('user triggers distributed load generation', async () => {
      const res = await fetch(`${BASE_URL}/generate-load`, { method: 'POST' });
      expect([200, 202]).toContain(res.status);
      const body = await res.json();
      expect(body).toHaveProperty('status');
    });

    test('user triggers single CPU load', async () => {
      const res = await fetch(`${BASE_URL}/cpu-load`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('complete');
      expect(body.elapsed).toBeGreaterThan(3000);
    }, 10000);

    test('health check still works during/after load', async () => {
      const res = await fetch(HEALTH_URL);
      expect(res.status).toBe(200);
    });
  });

  describe('Multiple concurrent users', () => {
    test('multiple users can access dashboard simultaneously', async () => {
      const promises = Array(5).fill(null).map(() => fetch(BASE_URL));
      const results = await Promise.all(promises);
      results.forEach(res => {
        expect(res.status).toBe(200);
      });
    });

    test('multiple users can check health simultaneously', async () => {
      const promises = Array(10).fill(null).map(() => fetch(HEALTH_URL));
      const results = await Promise.all(promises);
      results.forEach(res => {
        expect(res.status).toBe(200);
      });
    });

    test('multiple users can trigger load simultaneously', async () => {
      const promises = Array(3).fill(null).map(() => 
        fetch(`${BASE_URL}/generate-load`, { method: 'POST' })
      );
      const results = await Promise.all(promises);
      results.forEach(res => {
        expect([200, 202]).toContain(res.status);
      });
    });
  });

  describe('Error scenarios', () => {
    test('handles 404 for invalid routes gracefully', async () => {
      const res = await fetch(`${BASE_URL}/invalid-route`);
      expect(res.status).toBe(404);
    });

    test('handles invalid HTTP methods', async () => {
      const res = await fetch(`${BASE_URL}/health`, { method: 'DELETE' });
      expect([404, 405]).toContain(res.status);
    });

    test('health endpoint works after errors', async () => {
      // Trigger some errors
      await fetch(`${BASE_URL}/invalid-route`).catch(() => {});
      await fetch(`${BASE_URL}/another-invalid`).catch(() => {});
      
      // Health should still work
      const res = await fetch(HEALTH_URL);
      expect(res.status).toBe(200);
    });
  });

  describe('Performance under load', () => {
    test('health endpoint remains responsive', async () => {
      const start = Date.now();
      const res = await fetch(HEALTH_URL);
      const elapsed = Date.now() - start;
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(1000);
    });

    test('dashboard loads quickly', async () => {
      const start = Date.now();
      const res = await fetch(BASE_URL);
      const elapsed = Date.now() - start;
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe('Data consistency', () => {
    test('health endpoint returns consistent pod name', async () => {
      const res1 = await fetch(HEALTH_URL);
      const body1 = await res1.json();
      
      const res2 = await fetch(HEALTH_URL);
      const body2 = await res2.json();
      
      expect(body1.pod).toBe(body2.pod);
    });

    test('health endpoint returns increasing timestamps', async () => {
      const res1 = await fetch(HEALTH_URL);
      const body1 = await res1.json();
      const time1 = new Date(body1.timestamp).getTime();
      
      await new Promise(r => setTimeout(r, 100));
      
      const res2 = await fetch(HEALTH_URL);
      const body2 = await res2.json();
      const time2 = new Date(body2.timestamp).getTime();
      
      expect(time2).toBeGreaterThan(time1);
    });
  });
});
