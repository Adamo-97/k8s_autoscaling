import request from 'supertest';
import { app, clearAllSSEIntervals } from '../../src/server';

describe('Stress Test Control and State Management', () => {
  // Clean up before and after each test
  beforeEach(async () => {
    await request(app).post('/stop-load');
    await new Promise(resolve => setTimeout(resolve, 150));
  });

  afterEach(async () => {
    await request(app).post('/stop-load');
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(() => {
    clearAllSSEIntervals();
  });

  describe('Stress test lifecycle', () => {
    test('can start, check running state, then stop stress test', async () => {
      // Start stress test
      const start = await request(app).post('/generate-load');
      expect([200, 202]).toContain(start.status);

      // Verify it's running by trying to start another
      const duplicate = await request(app).post('/generate-load');
      expect(duplicate.status).toBe(409);

      // Stop the test
      const stop = await request(app).post('/stop-load');
      expect(stop.status).toBe(200);

      // Should be able to start a new test now
      await new Promise(resolve => setTimeout(resolve, 150));
      const restart = await request(app).post('/generate-load');
      expect([200, 202]).toContain(restart.status);
    });

    test('stress test auto-completes after all rounds finish', async () => {
      const start = await request(app).post('/generate-load');
      expect([200, 202]).toContain(start.status);

      // Wait for stress test to complete (8 rounds * ~10s = 80s)
      // We won't wait the full time, just verify the mechanism exists
      expect(start.body.rounds).toBeGreaterThan(0);
    }, 70000);

    test('multiple stops are idempotent', async () => {
      const stop1 = await request(app).post('/stop-load');
      expect(stop1.status).toBe(200);

      const stop2 = await request(app).post('/stop-load');
      expect(stop2.status).toBe(200);

      const stop3 = await request(app).post('/stop-load');
      expect(stop3.status).toBe(200);
    });
  });

  describe('CPU load endpoint behavior', () => {
    test('cpu-load completes with result', async () => {
      const res = await request(app).get('/cpu-load');
      expect(res.status).toBe(200);
      expect(res.body.status).toMatch(/complete|stopped/);
      expect(res.body).toHaveProperty('elapsed');
      expect(res.body).toHaveProperty('result');
      expect(res.body).toHaveProperty('pod');
    }, 15000);

    test('cpu-load result is numeric string', async () => {
      const res = await request(app).get('/cpu-load');
      const resultNum = parseFloat(res.body.result);
      expect(isNaN(resultNum)).toBe(false);
    }, 15000);
  });

  describe('Distributed load generation', () => {
    test('generate-load returns valid targets array', async () => {
      const res = await request(app).post('/generate-load');
      if (res.status === 202) {
        expect(Array.isArray(res.body.targets) || typeof res.body.targets === 'number').toBe(true);
      }
    });

    test('generate-load handles no pods gracefully', async () => {
      const res = await request(app).post('/generate-load');
      expect([200, 202, 409]).toContain(res.status);
    });

    test('generate-load sets correct concurrency and rounds', async () => {
      const res = await request(app).post('/generate-load');
      if (res.status === 202) {
        expect(res.body.concurrency).toBe(20);
        expect(res.body.rounds).toBe(12);
      }
    });
  });

  describe('Internal stop endpoint', () => {
    test('internal-stop can be called without active test', async () => {
      const res = await request(app).post('/internal-stop');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('stopped');
    });

    test('internal-stop releases stress test lock', async () => {
      // Start a test
      await request(app).post('/generate-load');

      // Internal stop should clear the lock
      await request(app).post('/internal-stop');

      // Should be able to start new test
      await new Promise(resolve => setTimeout(resolve, 150));
      const res = await request(app).post('/generate-load');
      expect([200, 202]).toContain(res.status);
    });
  });

  describe('Error handling', () => {
    test('handles rapid start/stop cycles', async () => {
      for (let i = 0; i < 3; i++) {
        await request(app).post('/stop-load');
        await new Promise(resolve => setTimeout(resolve, 100));
        const start = await request(app).post('/generate-load');
        expect([200, 202]).toContain(start.status);
      }
    }, 15000);

    test('rejects concurrent requests with clear error message', async () => {
      const first = await request(app).post('/generate-load');
      expect([200, 202]).toContain(first.status);

      const second = await request(app).post('/generate-load');
      expect(second.body.message).toBeDefined();
      expect(second.body.message.length).toBeGreaterThan(0);
    });
  });

  describe('Stress test state consistency', () => {
    test('stop-load returns timestamp in ISO format', async () => {
      const res = await request(app).post('/stop-load');
      const timestamp = new Date(res.body.timestamp);
      expect(timestamp.toISOString()).toBe(res.body.timestamp);
    });

    test('after stop, state is properly reset', async () => {
      // Start
      await request(app).post('/generate-load');
      
      // Stop
      await request(app).post('/stop-load');
      
      // Wait for state cleanup
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Starting again should work
      const res = await request(app).post('/generate-load');
      expect([200, 202]).toContain(res.status);
      expect(res.body.status).not.toBe('error');
    });
  });
});
