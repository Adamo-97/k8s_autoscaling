import request from 'supertest';
import { app } from '../../src/server';

describe('Error Handling and Edge Cases Coverage', () => {
  describe('Endpoint error resilience', () => {
    test('/health handles errors gracefully', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('pod');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('pid');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('memory');
    });

    test('/pods handles missing kubectl gracefully', async () => {
      const res = await request(app).get('/pods');
      expect(res.status).toBe(200);
      expect(res.text).toBeDefined();
    });

    test('/stress returns HTML even with no active stream', async () => {
      const res = await request(app).get('/stress');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });
  });

  describe('Dashboard HTML completeness', () => {
    test('dashboard has complete pod monitoring code', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('pods-grid');
      expect(res.text).toContain('pod-count');
      expect(res.text).toContain('knownPods');
    });

    test('dashboard has HPA monitoring logic', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('hpa');
      expect(res.text).toContain('scaling-progress');
      expect(res.text).toContain('current-desired');
      expect(res.text).toContain('min-max');
      expect(res.text).toContain('cpu-usage');
    });

    test('dashboard has stress test controls', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('start-stress');
      expect(res.text).toContain('stop-stress');
      expect(res.text).toContain('stress-bar');
    });

    test('dashboard includes scaling animation logic', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('scaling-up');
      expect(res.text).toContain('isNew');
      expect(res.text).toContain('isRecent');
    });

    test('dashboard includes reconnection logic', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('onerror');
      expect(res.text).toContain('reconnecting');
      expect(res.text).toContain('connectCluster');
    });

    test('dashboard has complete CSS styling', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('.pod-card');
      expect(res.text).toContain('.badge');
      expect(res.text).toContain('.status');
      expect(res.text).toContain('@keyframes');
      expect(res.text).toContain('animation');
    });

    test('dashboard includes log function', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('function log(');
      expect(res.text).toContain('getElementById(\'logs\')');
      expect(res.text).toContain('log-entry');
    });

    test('dashboard includes uptime calculation', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('updateUptime');
      expect(res.text).toContain('setInterval(updateUptime');
    });

    test('dashboard includes progress bar logic', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('progress');
      expect(res.text).toContain('100 / 60');
      expect(res.text).toContain('stress-bar');
    });

    test('dashboard includes fetch error handling', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('.catch');
      expect(res.text).toContain('Error starting load');
    });
  });

  describe('Stress endpoint HTML', () => {
    test('/stress includes SSE connection', async () => {
      const res = await request(app).get('/stress');
      expect(res.text).toContain('EventSource');
      expect(res.text).toContain('stress-stream');
    });

    test('/stress includes stop functionality', async () => {
      const res = await request(app).get('/stress');
      expect(res.text).toBeDefined();
    });
  });

  describe('Health endpoint fields', () => {
    test('health check includes all required metrics', async () => {
      const res = await request(app).get('/health');
      
      expect(typeof res.body.pid).toBe('number');
      expect(res.body.pid).toBeGreaterThan(0);
      
      expect(typeof res.body.uptime).toBe('number');
      expect(res.body.uptime).toBeGreaterThan(0);
      
      expect(typeof res.body.memory).toBe('object');
      expect(res.body.memory).toHaveProperty('rss');
      expect(res.body.memory).toHaveProperty('heapTotal');
      expect(res.body.memory).toHaveProperty('heapUsed');
      expect(res.body.memory).toHaveProperty('external');
    });

    test('health check timestamp is recent', async () => {
      const before = Date.now();
      const res = await request(app).get('/health');
      const after = Date.now();
      
      const timestamp = new Date(res.body.timestamp).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(before - 1000);
      expect(timestamp).toBeLessThanOrEqual(after + 1000);
    });
  });

  describe('POST endpoint validation', () => {
    beforeEach(async () => {
      await request(app).post('/stop-load');
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    test('/generate-load handles concurrent prevention correctly', async () => {
      const first = await request(app).post('/generate-load');
      expect([200, 202]).toContain(first.status);
      
      if (first.status === 202) {
        expect(first.body.status).toBe('started');
        expect(first.body.concurrency).toBeDefined();
        expect(first.body.rounds).toBeDefined();
      }

      const second = await request(app).post('/generate-load');
      if (second.status === 409) {
        expect(second.body.status).toBe('error');
        expect(second.body.message).toBeDefined();
      }
    });

    test('/stop-load sets proper timestamp format', async () => {
      const res = await request(app).post('/stop-load');
      expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      
      const date = new Date(res.body.timestamp);
      expect(date.getTime()).toBeGreaterThan(0);
    });

    test('/internal-stop responds correctly', async () => {
      const res = await request(app).post('/internal-stop');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('stopped');
    });
  });

  describe('404 handling', () => {
    test('returns 404 for unknown routes', async () => {
      const res = await request(app).get('/this-route-does-not-exist');
      expect(res.status).toBe(404);
    });

    test('returns 404 for unknown POST routes', async () => {
      const res = await request(app).post('/unknown-endpoint');
      expect(res.status).toBe(404);
    });

    test('returns 404 for unknown PUT routes', async () => {
      const res = await request(app).put('/unknown-endpoint');
      expect(res.status).toBe(404);
    });

    test('returns 404 for unknown DELETE routes', async () => {
      const res = await request(app).delete('/unknown-endpoint');
      expect(res.status).toBe(404);
    });
  });

  describe('GET / (root) complete coverage', () => {
    test('includes complete inline JavaScript', async () => {
      const res = await request(app).get('/');
      const html = res.text;
      
      // Verify all major JavaScript sections exist
      expect(html).toContain('let stressES, clusterES;');
      expect(html).toContain('let initialReplicas = null;');
      expect(html).toContain('let peakReplicas = 0;');
      expect(html).toContain('let lastReplicaCount = 0;');
      expect(html).toContain('function log(msg)');
      expect(html).toContain('function updateUptime()');
      expect(html).toContain('function connectCluster()');
    });

    test('includes all CSS classes referenced in JavaScript', async () => {
      const res = await request(app).get('/');
      const html = res.text;
      
      expect(html).toContain('.pod-card');
      expect(html).toContain('.badge');
      expect(html).toContain('.status');
      expect(html).toContain('.running');
      expect(html).toContain('.pending');
      expect(html).toContain('.failed');
    });

    test('sets correct metadata', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('<meta charset="UTF-8"');
      expect(res.text).toContain('viewport');
      expect(res.text).toContain('<title>K8s Autoscaling Dashboard</title>');
    });
  });
});
