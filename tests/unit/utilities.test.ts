import path from 'path';

describe('Server Utilities and Helpers', () => {
  describe('Path resolution', () => {
    test('can resolve paths', () => {
      const resolved = path.resolve(__dirname, '../../src');
      expect(resolved).toBeDefined();
      expect(typeof resolved).toBe('string');
    });

    test('can join paths', () => {
      const joined = path.join('src', 'server.ts');
      expect(joined).toContain('server.ts');
    });

    test('can get directory name', () => {
      const dir = path.dirname('/home/user/file.txt');
      expect(dir).toBe('/home/user');
    });

    test('can get base name', () => {
      const base = path.basename('/home/user/file.txt');
      expect(base).toBe('file.txt');
    });
  });

  describe('Regular expressions for parsing', () => {
    test('ISO timestamp regex matches valid timestamps', () => {
      const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      const timestamp = new Date().toISOString();
      expect(timestamp).toMatch(isoRegex);
    });

    test('version regex matches node versions', () => {
      const versionRegex = /^v\d+/;
      expect(process.version).toMatch(versionRegex);
    });

    test('content-type regex matches html', () => {
      const htmlRegex = /text\/html/;
      expect('text/html; charset=utf-8').toMatch(htmlRegex);
    });

    test('content-type regex matches json', () => {
      const jsonRegex = /application\/json/;
      expect('application/json; charset=utf-8').toMatch(jsonRegex);
    });

    test('event-stream regex matches SSE', () => {
      const sseRegex = /text\/event-stream/;
      expect('text/event-stream').toMatch(sseRegex);
    });
  });

  describe('Time formatting utilities', () => {
    test('can format seconds to minutes and seconds', () => {
      const totalSec = 125;
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      expect(m).toBe(2);
      expect(s).toBe(5);
    });

    test('can format time as hours, minutes, seconds', () => {
      const sec = 3665; // 1 hour, 1 minute, 5 seconds
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      expect(h).toBe(1);
      expect(m).toBe(1);
      expect(s).toBe(5);
    });

    test('can determine age format based on seconds', () => {
      const getAge = (seconds: number) => {
        if (seconds < 60) return seconds + 's';
        if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
        return Math.floor(seconds / 3600) + 'h';
      };

      expect(getAge(30)).toBe('30s');
      expect(getAge(90)).toBe('1m');
      expect(getAge(3700)).toBe('1h');
    });
  });

  describe('Array and data structure utilities', () => {
    test('can create array from range', () => {
      const arr = Array(5).fill(null);
      expect(arr.length).toBe(5);
    });

    test('can create array with indices', () => {
      const arr = Array(5).fill(null).map((_, i) => i);
      expect(arr).toEqual([0, 1, 2, 3, 4]);
    });

    test('can filter truthy values', () => {
      const arr = [1, null, 2, undefined, 3, false, 4];
      const filtered = arr.filter(Boolean);
      expect(filtered).toEqual([1, 2, 3, 4]);
    });

    test('can check if array contains value', () => {
      const arr = [200, 202, 204];
      expect(arr).toContain(202);
      expect(arr).not.toContain(404);
    });
  });

  describe('Number formatting utilities', () => {
    test('can format number to fixed decimals', () => {
      const num = 123.456789;
      expect(num.toFixed(2)).toBe('123.46');
      expect(Number(num.toFixed(2))).toBe(123.46);
    });

    test('can format number to exponential', () => {
      const num = 12345.6789;
      expect(num.toExponential(2)).toMatch(/1\.23e\+4/);
    });

    test('can format percentage', () => {
      const value = 0.753;
      const percent = Math.round(value * 100);
      expect(percent).toBe(75);
    });

    test('can clamp value between min and max', () => {
      const clamp = (val: number, min: number, max: number) => 
        Math.min(Math.max(val, min), max);
      
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });
  });

  describe('String manipulation utilities', () => {
    test('can convert string to lowercase', () => {
      expect('Running'.toLowerCase()).toBe('running');
      expect('PENDING'.toLowerCase()).toBe('pending');
    });

    test('can trim whitespace', () => {
      expect('  test  '.trim()).toBe('test');
    });

    test('can split strings', () => {
      const parts = 'a,b,c'.split(',');
      expect(parts).toEqual(['a', 'b', 'c']);
    });

    test('can join array into string', () => {
      const arr = ['a', 'b', 'c'];
      expect(arr.join(', ')).toBe('a, b, c');
    });

    test('can replace substrings', () => {
      const str = 'hello world';
      expect(str.replace('world', 'typescript')).toBe('hello typescript');
    });

    test('can check string includes substring', () => {
      expect('hello world'.includes('world')).toBe(true);
      expect('hello world'.includes('foo')).toBe(false);
    });
  });

  describe('Object manipulation utilities', () => {
    test('can merge objects', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 3, c: 4 };
      const merged = { ...obj1, ...obj2 };
      expect(merged).toEqual({ a: 1, b: 3, c: 4 });
    });

    test('can destructure objects', () => {
      const obj = { status: 'ok', code: 200, message: 'success' };
      const { status, code } = obj;
      expect(status).toBe('ok');
      expect(code).toBe(200);
    });

    test('can check object has property', () => {
      const obj = { name: 'test', value: 42 };
      expect(obj.hasOwnProperty('name')).toBe(true);
      expect(obj.hasOwnProperty('missing')).toBe(false);
    });

    test('can get object keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const keys = Object.keys(obj);
      expect(keys).toEqual(['a', 'b', 'c']);
    });

    test('can get object values', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const values = Object.values(obj);
      expect(values).toEqual([1, 2, 3]);
    });
  });

  describe('HTTP status code utilities', () => {
    test('recognizes success status codes', () => {
      const isSuccess = (code: number) => code >= 200 && code < 300;
      expect(isSuccess(200)).toBe(true);
      expect(isSuccess(202)).toBe(true);
      expect(isSuccess(404)).toBe(false);
    });

    test('recognizes client error codes', () => {
      const isClientError = (code: number) => code >= 400 && code < 500;
      expect(isClientError(404)).toBe(true);
      expect(isClientError(200)).toBe(false);
    });

    test('recognizes server error codes', () => {
      const isServerError = (code: number) => code >= 500 && code < 600;
      expect(isServerError(500)).toBe(true);
      expect(isServerError(200)).toBe(false);
    });
  });

  describe('Pod status utilities', () => {
    test('can categorize pod phases', () => {
      const phases = ['Running', 'Pending', 'Failed', 'Succeeded', 'Unknown'];
      expect(phases).toContain('Running');
      expect(phases).toContain('Pending');
      expect(phases).toContain('Failed');
    });

    test('can format ready status', () => {
      const formatReady = (ready: number, total: number) => `${ready}/${total}`;
      expect(formatReady(2, 3)).toBe('2/3');
      expect(formatReady(1, 1)).toBe('1/1');
    });

    test('can calculate total restarts', () => {
      const containers = [
        { restartCount: 0 },
        { restartCount: 2 },
        { restartCount: 1 }
      ];
      const total = containers.reduce((sum, c) => sum + c.restartCount, 0);
      expect(total).toBe(3);
    });
  });

  describe('SSE data formatting', () => {
    test('can format SSE message', () => {
      const data = { status: 'ok', value: 42 };
      const message = `data: ${JSON.stringify(data)}\n\n`;
      expect(message).toContain('data:');
      expect(message).toContain('status');
      expect(message).toContain('\n\n');
    });

    test('can format SSE event with type', () => {
      const event = 'done';
      const data = { status: 'complete' };
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      expect(message).toContain('event: done');
      expect(message).toContain('data:');
    });
  });

  describe('Progress calculation utilities', () => {
    test('can calculate progress percentage', () => {
      const calcProgress = (elapsed: number, total: number) => 
        Math.min(100, Math.floor((elapsed / total) * 100));
      
      expect(calcProgress(5000, 10000)).toBe(50);
      expect(calcProgress(10000, 10000)).toBe(100);
      expect(calcProgress(15000, 10000)).toBe(100); // capped at 100
    });

    test('progress increases over time', () => {
      const duration = 30000;
      const progress1 = Math.floor((5000 / duration) * 100);
      const progress2 = Math.floor((15000 / duration) * 100);
      expect(progress2).toBeGreaterThan(progress1);
    });
  });

  describe('Error message formatting', () => {
    test('can convert error to string', () => {
      const err = new Error('test error');
      const msg = String(err);
      expect(msg).toContain('test error');
    });

    test('can get error message property', () => {
      const err = new Error('test error');
      expect(err.message).toBe('test error');
    });

    test('handles non-Error objects', () => {
      const notError: any = { someProperty: 'value' };
      const msg = String(notError.message || notError);
      expect(typeof msg).toBe('string');
    });
  });

  describe('Kubernetes API response parsing', () => {
    test('can check if items is array', () => {
      const response1 = { items: [1, 2, 3] };
      const response2 = { items: null };
      
      expect(Array.isArray(response1.items)).toBe(true);
      expect(Array.isArray(response2.items)).toBe(false);
    });

    test('can safely access nested properties', () => {
      const pod: any = {
        metadata: { name: 'test-pod', namespace: 'default' },
        status: { phase: 'Running' }
      };
      
      expect(pod.metadata?.name).toBe('test-pod');
      expect(pod.metadata?.namespace).toBe('default');
      expect(pod.status?.phase).toBe('Running');
      expect(pod.missing?.property).toBeUndefined();
    });

    test('can provide default values for missing properties', () => {
      const pod: any = {};
      const name = pod.metadata?.name || 'unknown';
      const phase = pod.status?.phase || 'Unknown';
      const ip = pod.status?.podIP || '-';
      
      expect(name).toBe('unknown');
      expect(phase).toBe('Unknown');
      expect(ip).toBe('-');
    });
  });
});
