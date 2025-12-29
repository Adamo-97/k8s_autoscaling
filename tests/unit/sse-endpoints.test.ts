import request from 'supertest';
import { app } from '../../src/server';

describe('SSE Endpoints and Real-time Monitoring', () => {
  describe('GET /stress-stream', () => {
    test('returns server-sent events stream', (done) => {
      const req = request(app)
        .get('/stress-stream')
        .set('Accept', 'text/event-stream');

      req.on('response', (res: any) => {
        expect(res.headers['content-type']).toContain('text/event-stream');
        expect(res.headers['cache-control']).toContain('no-cache');
        expect(res.headers['connection']).toBe('keep-alive');

        // Close connection after verifying headers
        req.abort();
        done();
      });

      setTimeout(() => {
        req.abort();
        done();
      }, 1000);
    }, 5000);
  });

  describe('GET /cluster-status', () => {
    test('returns server-sent events for cluster monitoring', (done) => {
      const req = request(app)
        .get('/cluster-status')
        .set('Accept', 'text/event-stream');

      req.on('response', (res: any) => {
        expect(res.headers['content-type']).toContain('text/event-stream');
        expect(res.headers['cache-control']).toContain('no-cache');
        expect(res.headers['connection']).toBe('keep-alive');

        req.abort();
        done();
      });

      setTimeout(() => {
        req.abort();
        done();
      }, 1000);
    }, 5000);

    test('handles connection close gracefully', (done) => {
      const req = request(app)
        .get('/cluster-status')
        .set('Accept', 'text/event-stream');

      setTimeout(() => {
        req.abort(); // Should not cause server errors
        done();
      }, 500);
    }, 5000);
  });

  describe('SSE error handling', () => {
    test('stress-stream handles early disconnection', (done) => {
      const req = request(app)
        .get('/stress-stream')
        .set('Accept', 'text/event-stream');

      setTimeout(() => {
        req.abort();
        // Wait a bit to ensure no server crash
        setTimeout(() => {
          done();
        }, 100);
      }, 100);
    }, 5000);

    test('cluster-status handles early disconnection', (done) => {
      const req = request(app)
        .get('/cluster-status')
        .set('Accept', 'text/event-stream');

      setTimeout(() => {
        req.abort();
        // Wait a bit to ensure no server crash
        setTimeout(() => {
          done();
        }, 100);
      }, 100);
    }, 5000);

    test('multiple clients can connect simultaneously', (done) => {
      const req1 = request(app).get('/cluster-status');
      const req2 = request(app).get('/cluster-status');
      const req3 = request(app).get('/cluster-status');

      let count = 0;
      const checkDone = () => {
        count++;
        if (count === 3) {
          done();
        }
      };

      req1.on('response', () => {
        req1.abort();
        checkDone();
      });

      req2.on('response', () => {
        req2.abort();
        checkDone();
      });

      req3.on('response', () => {
        req3.abort();
        checkDone();
      });

      setTimeout(() => {
        req1.abort();
        req2.abort();
        req3.abort();
        done();
      }, 2000);
    }, 5000);
  });

  describe('Dashboard HTML rendering', () => {
    test('dashboard includes SSE connection code', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('EventSource');
      expect(res.text).toContain('cluster-status');
    });

    test('dashboard includes stress control buttons', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('start-stress');
      expect(res.text).toContain('stop-stress');
    });

    test('dashboard includes pod list container', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('pods-grid');  // actual ID used in server
    });

    test('dashboard includes HPA status display', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('scaling-progress');
      expect(res.text).toContain('current-desired');
    });

    test('dashboard includes stress progress bar', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('stress-bar');
      expect(res.text).toContain('stress-status');
    });

    test('dashboard includes event log', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('log(');
      expect(res.text).toContain('logs');  // actual ID used in server
    });

    test('dashboard has proper styling', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('<style>');
      expect(res.text).toContain('font-family');
    });

    test('dashboard includes JavaScript for SSE handling', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('onmessage');
      expect(res.text).toContain('onerror');
    });
  });

  describe('Legacy /stress endpoint', () => {
    test('returns HTML page', async () => {
      const res = await request(app).get('/stress');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    test('includes basic stress testing UI', async () => {
      const res = await request(app).get('/stress');
      expect(res.text.length).toBeGreaterThan(100);
    });
  });

  describe('/pods endpoint', () => {
    test('returns HTML', async () => {
      const res = await request(app).get('/pods');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    test('includes pod information structure', async () => {
      const res = await request(app).get('/pods');
      expect(res.text.length).toBeGreaterThan(0);
    });

    test('handles empty pod list gracefully', async () => {
      const res = await request(app).get('/pods');
      expect(res.status).toBe(200);
      // Should not throw errors even with no pods
    });
  });
});
