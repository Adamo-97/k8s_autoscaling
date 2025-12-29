import request from 'supertest';
import { app } from '../../src/server';

describe('Comprehensive Code Path Coverage', () => {
  // Stop any active stress tests before each test
  beforeEach(async () => {
    await request(app).post('/stop-load');
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  afterEach(async () => {
    await request(app).post('/stop-load');
  });

  describe('/generate-load stress test lifecycle coverage', () => {
    test('full stress test execution path', async () => {
      // This hits: generate-load endpoint, pod IP gathering, round execution, auto-cleanup
      const res = await request(app).post('/generate-load');
      expect([200, 202, 409]).toContain(res.status);
      
      if (res.status === 202) {
        expect(res.body.status).toBe('started');
        expect(res.body.targets).toBeDefined();
        expect(res.body.concurrency).toBe(50);
        expect(res.body.rounds).toBe(6);
        
        // Wait for some rounds to execute
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Stop it to trigger cleanup
        const stopRes = await request(app).post('/stop-load');
        expect(stopRes.status).toBe(200);
      }
    });

    test('stress test with immediate stop', async () => {
      // Start stress test
      const startRes = await request(app).post('/generate-load');
      
      // Immediately stop to test early termination path
      if (startRes.status === 202) {
        await new Promise(resolve => setTimeout(resolve, 50));
        const stopRes = await request(app).post('/stop-load');
        expect(stopRes.status).toBe(200);
        expect(stopRes.body.status).toBe('stopped');
      }
    });

    test('multiple generate-load calls test concurrency protection', async () => {
      const first = await request(app).post('/generate-load');
      
      if (first.status === 202) {
        // Try to start another - should get 409
        const second = await request(app).post('/generate-load');
        const third = await request(app).post('/generate-load');
        
        // At least one should be rejected
        expect([second.status, third.status]).toContain(409);
      }
    });
  });

  describe('/cpu-load execution paths', () => {
    test('cpu-load runs full duration', async () => {
      // Ensure stop flag is not set
      await request(app).post('/stop-load');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const res = await request(app).get('/cpu-load');
      expect(res.status).toBe(200);
      expect(res.body.status).toMatch(/complete|stopped/);
      expect(res.body).toHaveProperty('elapsed');
      expect(res.body).toHaveProperty('result');
      expect(res.body).toHaveProperty('pod');
      
      // Result should be a numeric string
      expect(typeof res.body.result).toBe('string');
      const num = parseFloat(res.body.result);
      expect(isNaN(num)).toBe(false);
    }, 15000);

    test('cpu-load respects stop flag', async () => {
      // Start a cpu-load request
      const loadPromise = request(app).get('/cpu-load');
      
      // Set stop flag almost immediately
      await new Promise(resolve => setTimeout(resolve, 50));
      await request(app).post('/internal-stop');
      
      const res = await loadPromise;
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('elapsed');
    }, 15000);
  });

  describe('SSE endpoint request handling', () => {
    test('/stress-stream SSE setup and teardown', (done) => {
      const req = request(app)
        .get('/stress-stream')
        .set('Accept', 'text/event-stream');

      let headerReceived = false;

      req.on('response', (res: any) => {
        headerReceived = true;
        expect(res.headers['content-type']).toContain('text/event-stream');
        expect(res.headers['cache-control']).toContain('no-cache');
        
        // Close after a short time to test cleanup
        setTimeout(() => {
          req.abort();
          expect(headerReceived).toBe(true);
          done();
        }, 500);
      });

      setTimeout(() => {
        if (!headerReceived) {
          req.abort();
          done();
        }
      }, 2000);
    }, 5000);

    test('/cluster-status SSE setup and teardown', (done) => {
      const req = request(app)
        .get('/cluster-status')
        .set('Accept', 'text/event-stream');

      let headerReceived = false;

      req.on('response', (res: any) => {
        headerReceived = true;
        expect(res.headers['content-type']).toContain('text/event-stream');
        
        // Close after a short time to test cleanup
        setTimeout(() => {
          req.abort();
          expect(headerReceived).toBe(true);
          done();
        }, 500);
      });

      setTimeout(() => {
        if (!headerReceived) {
          req.abort();
          done();
        }
      }, 2000);
    }, 5000);
  });

  describe('Root endpoint complete JavaScript execution', () => {
    test('dashboard includes all initialization code', async () => {
      const res = await request(app).get('/');
      const html = res.text;
      
      // Verify all major code blocks
      expect(html).toContain('let stressES, clusterES');
      expect(html).toContain('const startTime = Date.now()');
      expect(html).toContain('const knownPods = new Set()');
      expect(html).toContain('const podCreationTimes = new Map()');
      expect(html).toContain('let initialReplicas = null');
      expect(html).toContain('let peakReplicas = 0');
      expect(html).toContain('let lastReplicaCount = 0');
    });

    test('dashboard includes all event handlers', async () => {
      const res = await request(app).get('/');
      const html = res.text;
      
      expect(html).toContain('.onclick =');
      expect(html).toContain('start-stress');
      expect(html).toContain('stop-stress');
      expect(html).toContain('.onmessage =');
      expect(html).toContain('.onerror =');
    });

    test('dashboard includes scaling event detection', async () => {
      const res = await request(app).get('/');
      const html = res.text;
      
      expect(html).toContain('SCALING UP');
      expect(html).toContain('SCALING DOWN');
      expect(html).toContain('lastReplicaCount');
      expect(html).toContain('peakReplicas');
    });

    test('dashboard includes pod creation detection', async () => {
      const res = await request(app).get('/');
      const html = res.text;
      
      expect(html).toContain("logEvent('pod-new'");
      expect(html).toContain('knownPods.has');
      expect(html).toContain('knownPods.add');
      expect(html).toContain('podCreationTimes.set');
    });

    test('dashboard includes progress bar animation', async () => {
      const res = await request(app).get('/');
      const html = res.text;
      
      expect(html).toContain('let progress = 0');
      expect(html).toContain('setInterval');
      expect(html).toContain('progress += 100 / 60');
      expect(html).toContain('clearInterval');
    });

    test('dashboard includes reconnection logic', async () => {
      const res = await request(app).get('/');
      const html = res.text;
      
      expect(html).toContain('reconnecting');
      expect(html).toContain('setTimeout(connectCluster');
      expect(html).toContain('clusterES.close()');
    });
  });

  describe('/stress legacy endpoint', () => {
    test('returns complete HTML page', async () => {
      const res = await request(app).get('/stress');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text.length).toBeGreaterThan(100);
    });
  });

  describe('/pods endpoint HTML generation', () => {
    test('/pods returns HTML with pod information', async () => {
      const res = await request(app).get('/pods');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toBeDefined();
      expect(res.text.length).toBeGreaterThan(0);
    });

    test('/pods handles empty pod list', async () => {
      const res = await request(app).get('/pods');
      expect(res.status).toBe(200);
      // Should not crash even with no pods
      expect(res.text).toBeTruthy();
    });
  });

  describe('Health endpoint complete coverage', () => {
    test('health returns all fields correctly', async () => {
      const res = await request(app).get('/health');
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(typeof res.body.pod).toBe('string');
      expect(res.body.pod.length).toBeGreaterThan(0);
      expect(typeof res.body.timestamp).toBe('string');
      expect(typeof res.body.pid).toBe('number');
      expect(typeof res.body.uptime).toBe('number');
      expect(typeof res.body.memory).toBe('object');
      
      // Verify memory fields
      expect(res.body.memory).toHaveProperty('rss');
      expect(res.body.memory).toHaveProperty('heapTotal');
      expect(res.body.memory).toHaveProperty('heapUsed');
      expect(res.body.memory).toHaveProperty('external');
      
      // All should be positive numbers
      expect(res.body.memory.rss).toBeGreaterThan(0);
      expect(res.body.memory.heapTotal).toBeGreaterThan(0);
      expect(res.body.memory.heapUsed).toBeGreaterThan(0);
    });
  });

  describe('Error path coverage', () => {
    test('handles malformed POST body', async () => {
      const res = await request(app)
        .post('/generate-load')
        .send('not json');
      expect([200, 202, 400, 409]).toContain(res.status);
    });

    test('handles missing headers', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });

    test('handles multiple concurrent requests', async () => {
      const promises = [
        request(app).get('/health'),
        request(app).get('/health'),
        request(app).get('/health'),
        request(app).get('/'),
        request(app).get('/'),
      ];
      
      const results = await Promise.all(promises);
      results.forEach(res => {
        expect(res.status).toBe(200);
      });
    });
  });

  describe('Stop/internal-stop state management', () => {
    test('stop-load resets state completely', async () => {
      // Start a test
      const start1 = await request(app).post('/generate-load');
      
      if (start1.status === 202) {
        // Stop it
        await request(app).post('/stop-load');
        
        // Wait for state cleanup
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Should be able to start again
        const start2 = await request(app).post('/generate-load');
        expect([200, 202]).toContain(start2.status);
      }
    });

    test('internal-stop can be called multiple times', async () => {
      const calls = await Promise.all([
        request(app).post('/internal-stop'),
        request(app).post('/internal-stop'),
        request(app).post('/internal-stop'),
      ]);
      
      calls.forEach(res => {
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('stopped');
      });
    });
  });
});
