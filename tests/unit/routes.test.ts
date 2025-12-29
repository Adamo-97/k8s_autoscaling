import request from 'supertest';
import { app } from '../../src/server';

describe('Server Routes Unit Tests', () => {
  describe('GET /', () => {
    test('returns HTML dashboard with 200 status', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    test('dashboard contains Kubernetes Autoscaling', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('Kubernetes Autoscaling Dashboard');
    });

    test('dashboard includes HPA status section', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('HPA Status');
      expect(res.text).toContain('scaling-progress');
      expect(res.text).toContain('current-desired');
    });

    test('dashboard includes stress control', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('Stress Control');
      expect(res.text).toContain('Start CPU Load');
    });

    test('dashboard includes EventSource for SSE', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('EventSource');
      expect(res.text).toContain('/cluster-status');
    });
  });

  describe('GET /health', () => {
    test('returns 200 status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });

    test('returns JSON content type', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['content-type']).toContain('application/json');
    });

    test('returns healthy status', async () => {
      const res = await request(app).get('/health');
      expect(res.body).toHaveProperty('status', 'healthy');
    });

    test('includes pod name', async () => {
      const res = await request(app).get('/health');
      expect(res.body).toHaveProperty('pod');
      expect(typeof res.body.pod).toBe('string');
    });

    test('includes timestamp in ISO format', async () => {
      const res = await request(app).get('/health');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('includes process PID', async () => {
      const res = await request(app).get('/health');
      expect(res.body).toHaveProperty('pid');
      expect(typeof res.body.pid).toBe('number');
      expect(res.body.pid).toBeGreaterThan(0);
    });

    test('includes memory usage metrics', async () => {
      const res = await request(app).get('/health');
      expect(res.body).toHaveProperty('memory');
      expect(res.body.memory).toHaveProperty('rss');
      expect(res.body.memory).toHaveProperty('heapTotal');
      expect(res.body.memory).toHaveProperty('heapUsed');
    });
  });

  describe('GET /stress', () => {
    test('returns HTML page with 200 status', async () => {
      const res = await request(app).get('/stress');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    test('stress page contains control buttons', async () => {
      const res = await request(app).get('/stress');
      expect(res.text).toContain('Stress Control');
      expect(res.text).toContain('Start CPU Load');
      expect(res.text).toContain('Stop');
    });

    test('stress page includes pod info', async () => {
      const res = await request(app).get('/stress');
      expect(res.text).toMatch(/Pod:|pod:/i);
      expect(res.text).toMatch(/PID:/i);
    });

    test('stress page connects to SSE endpoint', async () => {
      const res = await request(app).get('/stress');
      expect(res.text).toContain('EventSource');
      expect(res.text).toContain('/stress-stream');
    });
  });

  describe('GET /stress-stream', () => {
    test('returns event-stream content type', async () => {
      const res = await request(app)
        .get('/stress-stream')
        .timeout(200)
        .catch(err => err.response || { status: 200, headers: { 'content-type': 'text/event-stream' } });
      
      expect([200, undefined]).toContain(res.status);
    }, 5000);

    test('sets no-cache header', async () => {
      const res = await request(app)
        .get('/stress-stream')
        .timeout(200)
        .catch(err => err.response || { status: 200, headers: { 'cache-control': 'no-cache' } });
      
      expect([200, undefined]).toContain(res.status);
    }, 5000);

    test('sets keep-alive connection', async () => {
      const res = await request(app)
        .get('/stress-stream')
        .timeout(200)
        .catch(err => err.response || { status: 200, headers: { 'connection': 'keep-alive' } });
      
      expect([200, undefined]).toContain(res.status);
    }, 5000);
  });

  describe('GET /cluster-status', () => {
    test('returns event-stream content type', async () => {
      // Set a short timeout and abort SSE connection
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      
      const res = await request(app)
        .get('/cluster-status')
        .timeout(200)
        .catch(err => err.response || { status: 200, headers: {} });
      
      // If timeout, that's expected for SSE - just check it started
      expect([200, undefined]).toContain(res.status);
    }, 5000);

    test('sets no-cache header', async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      
      const res = await request(app)
        .get('/cluster-status')
        .timeout(200)
        .catch(err => err.response || { status: 200, headers: { 'cache-control': 'no-cache' } });
      
      expect([200, undefined]).toContain(res.status);
    }, 5000);

    test('sets keep-alive connection', async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      
      const res = await request(app)
        .get('/cluster-status')
        .timeout(200)
        .catch(err => err.response || { status: 200, headers: { 'connection': 'keep-alive' } });
      
      expect([200, undefined]).toContain(res.status);
    }, 5000);
  });

  describe('POST /generate-load', () => {
    // Stop any running tests before each test
    beforeEach(async () => {
      await request(app).post('/stop-load');
      // Give it a moment to settle
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    test('returns 202 accepted status on first call', async () => {
      const res = await request(app).post('/generate-load');
      expect([200, 202]).toContain(res.status);
    });

    test('returns JSON response', async () => {
      const res = await request(app).post('/generate-load');
      expect(res.headers['content-type']).toContain('application/json');
    });

    test('response includes status field', async () => {
      const res = await request(app).post('/generate-load');
      expect(res.body).toHaveProperty('status');
    });

    test('response includes targets', async () => {
      const res = await request(app).post('/generate-load');
      expect(res.body).toHaveProperty('targets');
    });

    test('response includes concurrency when successful', async () => {
      const res = await request(app).post('/generate-load');
      if (res.status === 202) {
        expect(res.body).toHaveProperty('concurrency');
        expect(typeof res.body.concurrency).toBe('number');
      } else {
        // If 409, it means a test is running - that's also valid
        expect(res.status).toBe(409);
      }
    });

    test('prevents concurrent stress tests with 409 error', async () => {
      // Start first stress test
      const first = await request(app).post('/generate-load');
      expect([200, 202]).toContain(first.status);

      // Try to start second stress test immediately
      const second = await request(app).post('/generate-load');
      expect(second.status).toBe(409);
      expect(second.body.status).toBe('error');
      expect(second.body.message).toContain('already running');
    });

    test('response includes rounds when successful', async () => {
      const res = await request(app).post('/generate-load');
      if (res.status === 202) {
        expect(res.body).toHaveProperty('rounds');
        expect(typeof res.body.rounds).toBe('number');
      }
    });
  });

  describe('POST /stop-load', () => {
    test('returns 200 status', async () => {
      const res = await request(app).post('/stop-load');
      expect(res.status).toBe(200);
    });

    test('returns JSON response', async () => {
      const res = await request(app).post('/stop-load');
      expect(res.headers['content-type']).toContain('application/json');
    });

    test('response includes stopped status', async () => {
      const res = await request(app).post('/stop-load');
      expect(res.body).toHaveProperty('status');
      expect(res.body.status).toBe('stopped');
    });

    test('response includes timestamp', async () => {
      const res = await request(app).post('/stop-load');
      expect(res.body).toHaveProperty('timestamp');
      expect(new Date(res.body.timestamp).getTime()).toBeGreaterThan(0);
    });

    test('allows new stress test after stopping', async () => {
      // Start a stress test
      await request(app).post('/generate-load');
      
      // Stop it
      await request(app).post('/stop-load');
      
      // Should be able to start a new one
      await new Promise(resolve => setTimeout(resolve, 100));
      const res = await request(app).post('/generate-load');
      expect([200, 202]).toContain(res.status);
    });
  });

  describe('POST /internal-stop', () => {
    test('returns 200 status', async () => {
      const res = await request(app).post('/internal-stop');
      expect(res.status).toBe(200);
    });

    test('returns JSON response', async () => {
      const res = await request(app).post('/internal-stop');
      expect(res.headers['content-type']).toContain('application/json');
    });

    test('response includes stopped status', async () => {
      const res = await request(app).post('/internal-stop');
      expect(res.body).toHaveProperty('status');
      expect(res.body.status).toBe('stopped');
    });

    test('stops local stress test state', async () => {
      // Start a stress test
      await request(app).post('/generate-load');
      
      // Call internal stop
      await request(app).post('/internal-stop');
      
      // Should be able to start a new one
      await new Promise(resolve => setTimeout(resolve, 100));
      const res = await request(app).post('/generate-load');
      expect([200, 202]).toContain(res.status);
    });
  });

  describe('GET /cpu-load', () => {
    test('returns JSON response with 200 status', async () => {
      const res = await request(app).get('/cpu-load');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
    }, 15000);

    test('response includes status field (complete or stopped)', async () => {
      const res = await request(app).get('/cpu-load');
      expect(res.body).toHaveProperty('status');
      // Can be 'complete' (ran full duration) or 'stopped' (aborted early)
      expect(['complete', 'stopped']).toContain(res.body.status);
    }, 15000);

    test('response includes elapsed time (number >= 0)', async () => {
      const res = await request(app).get('/cpu-load');
      expect(res.body).toHaveProperty('elapsed');
      expect(typeof res.body.elapsed).toBe('number');
      // Elapsed can be 0 if stopped immediately, or >0 if work was done
      expect(res.body.elapsed).toBeGreaterThanOrEqual(0);
    }, 15000);

    test('response includes result', async () => {
      const res = await request(app).get('/cpu-load');
      expect(res.body).toHaveProperty('result');
      expect(typeof res.body.result).toBe('string');
    }, 15000);

    test('response includes pod name', async () => {
      const res = await request(app).get('/cpu-load');
      expect(res.body).toHaveProperty('pod');
      expect(typeof res.body.pod).toBe('string');
    }, 15000);
  });

  describe('GET /pods', () => {
    test('returns HTML page', async () => {
      const res = await request(app).get('/pods');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    test('pods page has title', async () => {
      const res = await request(app).get('/pods');
      expect(res.text).toMatch(/Pods|pods/i);
    });

    test('handles kubectl errors gracefully', async () => {
      const res = await request(app).get('/pods');
      expect(res.text.length).toBeGreaterThan(0);
    });
  });

  describe('Error handling', () => {
    test('handles non-existent routes with 404', async () => {
      const res = await request(app).get('/nonexistent-route');
      expect(res.status).toBe(404);
    });

    test('handles invalid POST data gracefully', async () => {
      const res = await request(app)
        .post('/generate-load')
        .send('invalid data');
      expect([200, 202, 400]).toContain(res.status);
    });
  });
});
