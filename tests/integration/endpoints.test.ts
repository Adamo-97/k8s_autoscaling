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

describe.skip('Server Endpoints - Comprehensive Tests', () => {
  let proc: ChildProcess | null = null;
  const PORT = '3001'; // Use different port for integration tests
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

  describe('GET /', () => {
    test('returns HTML dashboard', async () => {
      const res = await fetch(BASE_URL);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
    });

    test('dashboard contains Team 22 title', async () => {
      const res = await fetch(BASE_URL);
      const html = await res.text();
      expect(html).toContain('Team 22');
      expect(html).toContain('Kubernetes Autoscaling Dashboard');
    });

    test('dashboard includes pod name', async () => {
      const res = await fetch(BASE_URL);
      const html = await res.text();
      expect(html).toMatch(/Served by pod:|pod:/i);
    });

    test('dashboard includes HPA status elements', async () => {
      const res = await fetch(BASE_URL);
      const html = await res.text();
      expect(html).toContain('HPA Status');
      expect(html).toContain('current-replicas');
      expect(html).toContain('desired-replicas');
    });

    test('dashboard includes stress control', async () => {
      const res = await fetch(BASE_URL);
      const html = await res.text();
      expect(html).toContain('Stress Control');
      expect(html).toContain('Start CPU Load');
    });

    test('dashboard includes JavaScript for SSE', async () => {
      const res = await fetch(BASE_URL);
      const html = await res.text();
      expect(html).toContain('EventSource');
      expect(html).toContain('/cluster-status');
    });

    test('dashboard includes CSS styles', async () => {
      const res = await fetch(BASE_URL);
      const html = await res.text();
      expect(html).toContain('<style>');
      expect(html).toMatch(/--bg:|background:/);
    });
  });

  describe('GET /health', () => {
    test('returns 200 status', async () => {
      const res = await fetch(HEALTH_URL);
      expect(res.status).toBe(200);
    });

    test('returns JSON content type', async () => {
      const res = await fetch(HEALTH_URL);
      expect(res.headers.get('content-type')).toContain('application/json');
    });

    test('returns healthy status', async () => {
      const res = await fetch(HEALTH_URL);
      const body = await res.json();
      expect(body).toHaveProperty('status', 'healthy');
    });

    test('includes pod name', async () => {
      const res = await fetch(HEALTH_URL);
      const body = await res.json();
      expect(body).toHaveProperty('pod');
      expect(typeof body.pod).toBe('string');
      expect(body.pod.length).toBeGreaterThan(0);
    });

    test('includes timestamp', async () => {
      const res = await fetch(HEALTH_URL);
      const body = await res.json();
      expect(body).toHaveProperty('timestamp');
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('includes process PID', async () => {
      const res = await fetch(HEALTH_URL);
      const body = await res.json();
      expect(body).toHaveProperty('pid');
      expect(typeof body.pid).toBe('number');
      expect(body.pid).toBeGreaterThan(0);
    });

    test('includes memory usage', async () => {
      const res = await fetch(HEALTH_URL);
      const body = await res.json();
      expect(body).toHaveProperty('memory');
      expect(body.memory).toHaveProperty('rss');
      expect(body.memory).toHaveProperty('heapTotal');
      expect(body.memory).toHaveProperty('heapUsed');
    });

    test('can be called multiple times', async () => {
      const res1 = await fetch(HEALTH_URL);
      const res2 = await fetch(HEALTH_URL);
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });
  });

  describe('GET /stress', () => {
    test('returns HTML page', async () => {
      const res = await fetch(`${BASE_URL}/stress`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
    });

    test('stress page contains control elements', async () => {
      const res = await fetch(`${BASE_URL}/stress`);
      const html = await res.text();
      expect(html).toContain('Stress Control');
      expect(html).toContain('Start CPU Load');
      expect(html).toContain('Stop');
    });

    test('stress page includes pod information', async () => {
      const res = await fetch(`${BASE_URL}/stress`);
      const html = await res.text();
      expect(html).toMatch(/Pod:|pod:/i);
      expect(html).toMatch(/PID:/i);
    });

    test('stress page connects to SSE endpoint', async () => {
      const res = await fetch(`${BASE_URL}/stress`);
      const html = await res.text();
      expect(html).toContain('EventSource');
      expect(html).toContain('/stress-stream');
    });
  });

  describe('GET /stress-stream', () => {
    test('returns event-stream content type', async () => {
      const res = await fetch(`${BASE_URL}/stress-stream`);
      expect(res.status).toBe(200);
      const contentType = res.headers.get('content-type') || '';
      expect(contentType).toMatch(/text\/event-stream/);
    });

    test('sets no-cache headers', async () => {
      const res = await fetch(`${BASE_URL}/stress-stream`);
      expect(res.headers.get('cache-control')).toBe('no-cache');
    });

    test('sets keep-alive connection', async () => {
      const res = await fetch(`${BASE_URL}/stress-stream`);
      expect(res.headers.get('connection')).toBe('keep-alive');
    });

    test('stream can be closed', async () => {
      const controller = new AbortController();
      const res = await fetch(`${BASE_URL}/stress-stream`, { 
        signal: controller.signal 
      }).catch(() => null);
      
      controller.abort();
      expect(res).toBeTruthy();
    }, 10000);
  });

  describe('GET /cluster-status', () => {
    test('returns event-stream content type', async () => {
      const res = await fetch(`${BASE_URL}/cluster-status`);
      expect(res.status).toBe(200);
      const contentType = res.headers.get('content-type') || '';
      expect(contentType).toMatch(/text\/event-stream/);
    });

    test('sets no-cache headers', async () => {
      const res = await fetch(`${BASE_URL}/cluster-status`);
      expect(res.headers.get('cache-control')).toBe('no-cache');
    });

    test('sets keep-alive connection', async () => {
      const res = await fetch(`${BASE_URL}/cluster-status`);
      expect(res.headers.get('connection')).toBe('keep-alive');
    });
  });

  describe('POST /generate-load', () => {
    test('returns 202 or 200 status', async () => {
      const res = await fetch(`${BASE_URL}/generate-load`, { method: 'POST' });
      expect([200, 202]).toContain(res.status);
    });

    test('returns JSON response', async () => {
      const res = await fetch(`${BASE_URL}/generate-load`, { method: 'POST' });
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = await res.json();
      expect(body).toHaveProperty('status');
    });

    test('response includes status field', async () => {
      const res = await fetch(`${BASE_URL}/generate-load`, { method: 'POST' });
      const body = await res.json();
      expect(body).toHaveProperty('status');
      expect(typeof body.status).toBe('string');
    });

    test('response includes targets information', async () => {
      const res = await fetch(`${BASE_URL}/generate-load`, { method: 'POST' });
      const body = await res.json();
      expect(body).toHaveProperty('targets');
    });

    test('response includes concurrency information', async () => {
      const res = await fetch(`${BASE_URL}/generate-load`, { method: 'POST' });
      const body = await res.json();
      expect(body).toHaveProperty('concurrency');
      expect(typeof body.concurrency).toBe('number');
    });
  });

  describe('GET /cpu-load', () => {
    test('returns JSON response', async () => {
      const res = await fetch(`${BASE_URL}/cpu-load`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
    });

    test('response includes status complete', async () => {
      const res = await fetch(`${BASE_URL}/cpu-load`);
      const body = await res.json();
      expect(body).toHaveProperty('status', 'complete');
    });

    test('response includes elapsed time', async () => {
      const res = await fetch(`${BASE_URL}/cpu-load`);
      const body = await res.json();
      expect(body).toHaveProperty('elapsed');
      expect(typeof body.elapsed).toBe('number');
      expect(body.elapsed).toBeGreaterThan(0);
    });

    test('response includes computation result', async () => {
      const res = await fetch(`${BASE_URL}/cpu-load`);
      const body = await res.json();
      expect(body).toHaveProperty('result');
      expect(typeof body.result).toBe('string');
    });

    test('response includes pod name', async () => {
      const res = await fetch(`${BASE_URL}/cpu-load`);
      const body = await res.json();
      expect(body).toHaveProperty('pod');
      expect(typeof body.pod).toBe('string');
    });

    test('computation takes reasonable time', async () => {
      const start = Date.now();
      const res = await fetch(`${BASE_URL}/cpu-load`);
      const elapsed = Date.now() - start;
      expect(res.status).toBe(200);
      expect(elapsed).toBeGreaterThan(3000); // At least 3 seconds
      expect(elapsed).toBeLessThan(10000); // Less than 10 seconds
    }, 15000);

    test('can handle concurrent requests', async () => {
      const promises = [
        fetch(`${BASE_URL}/cpu-load`),
        fetch(`${BASE_URL}/cpu-load`),
        fetch(`${BASE_URL}/cpu-load`)
      ];
      const results = await Promise.all(promises);
      results.forEach(res => {
        expect(res.status).toBe(200);
      });
    }, 20000);
  });

  describe('GET /pods', () => {
    test('returns HTML page', async () => {
      const res = await fetch(`${BASE_URL}/pods`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
    });

    test('pods page has title', async () => {
      const res = await fetch(`${BASE_URL}/pods`);
      const html = await res.text();
      expect(html).toMatch(/Pods|pods/);
    });

    test('handles kubectl unavailable gracefully', async () => {
      const res = await fetch(`${BASE_URL}/pods`);
      const html = await res.text();
      // Should either show pods or error message, but not crash
      expect(html.length).toBeGreaterThan(0);
    });
  });

  describe('Error handling and edge cases', () => {
    test('handles non-existent routes with 404', async () => {
      const res = await fetch(`${BASE_URL}/nonexistent-route`);
      expect(res.status).toBe(404);
    });

    test('handles invalid HTTP methods appropriately', async () => {
      const res = await fetch(`${BASE_URL}/health`, { method: 'DELETE' });
      // Should be 404 or 405
      expect([404, 405]).toContain(res.status);
    });

    test('handles malformed JSON in POST', async () => {
      const res = await fetch(`${BASE_URL}/generate-load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json'
      });
      // Should handle gracefully (either accept or reject)
      expect([200, 202, 400]).toContain(res.status);
    });
  });

  describe('Performance and reliability', () => {
    test('health endpoint responds quickly', async () => {
      const start = Date.now();
      const res = await fetch(HEALTH_URL);
      const elapsed = Date.now() - start;
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(1000);
    });

    test('can handle rapid successive requests', async () => {
      const promises = Array(10).fill(null).map(() => fetch(HEALTH_URL));
      const results = await Promise.all(promises);
      results.forEach(res => {
        expect(res.status).toBe(200);
      });
    });

    test('server handles multiple endpoint types simultaneously', async () => {
      const promises = [
        fetch(HEALTH_URL),
        fetch(BASE_URL),
        fetch(`${BASE_URL}/stress`),
        fetch(`${BASE_URL}/pods`)
      ];
      const results = await Promise.all(promises);
      results.forEach(res => {
        expect(res.status).toBe(200);
      });
    });
  });
});
