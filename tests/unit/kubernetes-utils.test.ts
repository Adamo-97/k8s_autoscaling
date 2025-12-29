import {
  parsePodMetadata,
  parsePodStatus,
  getPodReadyStatus,
  getPodRestartCount,
  calculatePodAgeSeconds,
  formatAge,
  parsePodInfo,
  parseHPAStatus,
  parseKubectlPods,
  extractPodIPs,
  buildTargetUrl,
  distributeTarget,
  calculateScalingPercentage,
  isNewPod,
  formatSSEMessage,
  createStressResult,
  createHealthResponse,
  createStopResponse,
  createGenerateLoadResponse,
  createConcurrentTestError,
  createInternalStopResponse,
  generatePodCardHtml,
  generatePodsPageHtml,
  generatePodsErrorHtml
} from '../../src/utils/kubernetes';

describe('Kubernetes Utility Functions', () => {
  describe('parsePodMetadata', () => {
    test('extracts name and namespace from valid pod', () => {
      const pod = {
        metadata: { name: 'test-pod', namespace: 'default' }
      };
      expect(parsePodMetadata(pod)).toEqual({
        name: 'test-pod',
        namespace: 'default'
      });
    });

    test('returns defaults for missing metadata', () => {
      expect(parsePodMetadata({})).toEqual({
        name: 'unknown',
        namespace: 'default'
      });
    });

    test('handles null/undefined', () => {
      expect(parsePodMetadata(null)).toEqual({
        name: 'unknown',
        namespace: 'default'
      });
      expect(parsePodMetadata(undefined)).toEqual({
        name: 'unknown',
        namespace: 'default'
      });
    });
  });

  describe('parsePodStatus', () => {
    test('extracts phase and IP from valid pod', () => {
      const pod = {
        status: { phase: 'Running', podIP: '10.0.0.1' }
      };
      expect(parsePodStatus(pod)).toEqual({
        phase: 'Running',
        ip: '10.0.0.1'
      });
    });

    test('returns defaults for missing status', () => {
      expect(parsePodStatus({})).toEqual({
        phase: 'Unknown',
        ip: '-'
      });
    });

    test('handles Pending phase', () => {
      const pod = { status: { phase: 'Pending' } };
      expect(parsePodStatus(pod).phase).toBe('Pending');
    });

    test('handles Failed phase', () => {
      const pod = { status: { phase: 'Failed' } };
      expect(parsePodStatus(pod).phase).toBe('Failed');
    });
  });

  describe('getPodReadyStatus', () => {
    test('counts ready containers correctly', () => {
      const pod = {
        status: {
          containerStatuses: [
            { ready: true },
            { ready: true },
            { ready: false }
          ]
        }
      };
      expect(getPodReadyStatus(pod)).toBe('2/3');
    });

    test('returns 0/0 for no containers', () => {
      expect(getPodReadyStatus({})).toBe('0/0');
    });

    test('handles all ready containers', () => {
      const pod = {
        status: {
          containerStatuses: [{ ready: true }, { ready: true }]
        }
      };
      expect(getPodReadyStatus(pod)).toBe('2/2');
    });

    test('handles no ready containers', () => {
      const pod = {
        status: {
          containerStatuses: [{ ready: false }, { ready: false }]
        }
      };
      expect(getPodReadyStatus(pod)).toBe('0/2');
    });
  });

  describe('getPodRestartCount', () => {
    test('sums restart counts', () => {
      const pod = {
        status: {
          containerStatuses: [
            { restartCount: 2 },
            { restartCount: 3 },
            { restartCount: 1 }
          ]
        }
      };
      expect(getPodRestartCount(pod)).toBe(6);
    });

    test('returns 0 for no containers', () => {
      expect(getPodRestartCount({})).toBe(0);
    });

    test('handles missing restartCount', () => {
      const pod = {
        status: {
          containerStatuses: [{ restartCount: 5 }, {}]
        }
      };
      expect(getPodRestartCount(pod)).toBe(5);
    });
  });

  describe('calculatePodAgeSeconds', () => {
    test('calculates age from valid timestamp', () => {
      const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
      const age = calculatePodAgeSeconds(oneMinuteAgo);
      expect(age).toBeGreaterThanOrEqual(59);
      expect(age).toBeLessThanOrEqual(61);
    });

    test('returns 9999 for undefined', () => {
      expect(calculatePodAgeSeconds(undefined)).toBe(9999);
    });

    test('returns 9999 for invalid timestamp', () => {
      expect(calculatePodAgeSeconds('not-a-date')).toBe(9999);
    });

    test('handles recent creation', () => {
      const now = new Date().toISOString();
      const age = calculatePodAgeSeconds(now);
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThanOrEqual(2);
    });
  });

  describe('formatAge', () => {
    test('formats seconds', () => {
      expect(formatAge(30)).toBe('30s');
      expect(formatAge(59)).toBe('59s');
    });

    test('formats minutes', () => {
      expect(formatAge(60)).toBe('1m');
      expect(formatAge(120)).toBe('2m');
      expect(formatAge(3599)).toBe('59m');
    });

    test('formats hours', () => {
      expect(formatAge(3600)).toBe('1h');
      expect(formatAge(7200)).toBe('2h');
      expect(formatAge(86400)).toBe('24h');
    });

    test('returns - for special values', () => {
      expect(formatAge(9999)).toBe('-');
      expect(formatAge(-1)).toBe('-');
    });

    test('handles zero', () => {
      expect(formatAge(0)).toBe('0s');
    });
  });

  describe('parsePodInfo', () => {
    test('parses complete pod info', () => {
      const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
      const pod = {
        metadata: { name: 'my-pod', namespace: 'prod', creationTimestamp: oneMinuteAgo },
        status: {
          phase: 'Running',
          podIP: '10.0.0.5',
          containerStatuses: [{ ready: true, restartCount: 1 }]
        }
      };

      const info = parsePodInfo(pod);
      expect(info.name).toBe('my-pod');
      expect(info.namespace).toBe('prod');
      expect(info.phase).toBe('Running');
      expect(info.ip).toBe('10.0.0.5');
      expect(info.ready).toBe('1/1');
      expect(info.restarts).toBe(1);
      expect(info.age).toBe('1m');
    });

    test('handles empty pod', () => {
      const info = parsePodInfo({});
      expect(info.name).toBe('unknown');
      expect(info.phase).toBe('Unknown');
      expect(info.age).toBe('-');
    });
  });

  describe('parseHPAStatus', () => {
    test('parses complete HPA status', () => {
      const hpa = {
        spec: { minReplicas: 2, maxReplicas: 10 },
        status: {
          currentReplicas: 5,
          desiredReplicas: 6,
          currentCPUUtilizationPercentage: 75
        }
      };

      const status = parseHPAStatus(hpa);
      expect(status.current).toBe(5);
      expect(status.desired).toBe(6);
      expect(status.min).toBe(2);
      expect(status.max).toBe(10);
      expect(status.cpu).toBe('75%');
    });

    test('returns defaults for empty HPA', () => {
      const status = parseHPAStatus({});
      expect(status.current).toBe(0);
      expect(status.desired).toBe(0);
      expect(status.min).toBe(1);
      expect(status.max).toBe(10);
      expect(status.cpu).toBe('—');
    });

    test('handles missing CPU metric', () => {
      const hpa = { status: { currentReplicas: 3 } };
      expect(parseHPAStatus(hpa).cpu).toBe('—');
    });
  });

  describe('parseKubectlPods', () => {
    test('parses valid JSON output', () => {
      const stdout = JSON.stringify({
        items: [{ metadata: { name: 'pod-1' } }, { metadata: { name: 'pod-2' } }]
      });
      const pods = parseKubectlPods(stdout);
      expect(pods).toHaveLength(2);
      expect(pods[0].metadata.name).toBe('pod-1');
    });

    test('returns empty array for empty string', () => {
      expect(parseKubectlPods('')).toEqual([]);
    });

    test('returns empty array for invalid JSON', () => {
      expect(parseKubectlPods('not json')).toEqual([]);
    });

    test('returns empty array for missing items', () => {
      expect(parseKubectlPods('{}')).toEqual([]);
    });
  });

  describe('extractPodIPs', () => {
    test('extracts IPs from pods', () => {
      const pods = [
        { status: { podIP: '10.0.0.1' } },
        { status: { podIP: '10.0.0.2' } },
        { status: {} }
      ];
      expect(extractPodIPs(pods)).toEqual(['10.0.0.1', '10.0.0.2']);
    });

    test('returns empty array for no IPs', () => {
      expect(extractPodIPs([{}, {}])).toEqual([]);
    });

    test('handles empty array', () => {
      expect(extractPodIPs([])).toEqual([]);
    });
  });

  describe('buildTargetUrl', () => {
    test('builds URL with default port', () => {
      expect(buildTargetUrl('10.0.0.1')).toBe('http://10.0.0.1:3000/cpu-load');
    });

    test('builds URL with custom port', () => {
      expect(buildTargetUrl('10.0.0.1', 8080)).toBe('http://10.0.0.1:8080/cpu-load');
    });
  });

  describe('distributeTarget', () => {
    test('distributes using round-robin', () => {
      const targets = ['a', 'b', 'c'];
      expect(distributeTarget(targets, 0)).toBe('a');
      expect(distributeTarget(targets, 1)).toBe('b');
      expect(distributeTarget(targets, 2)).toBe('c');
      expect(distributeTarget(targets, 3)).toBe('a');
      expect(distributeTarget(targets, 4)).toBe('b');
    });

    test('returns localhost for empty array', () => {
      expect(distributeTarget([], 0)).toBe('127.0.0.1');
    });
  });

  describe('calculateScalingPercentage', () => {
    test('calculates correct percentage', () => {
      expect(calculateScalingPercentage(5, 1, 10)).toBeCloseTo(44.44, 1);
      expect(calculateScalingPercentage(1, 1, 10)).toBe(0);
      expect(calculateScalingPercentage(10, 1, 10)).toBe(100);
    });

    test('clamps to 0-100 range', () => {
      expect(calculateScalingPercentage(0, 1, 10)).toBe(0);
      expect(calculateScalingPercentage(15, 1, 10)).toBe(100);
    });

    test('handles min equals max', () => {
      expect(calculateScalingPercentage(5, 5, 5)).toBe(0);
      expect(calculateScalingPercentage(6, 5, 5)).toBe(100);
    });
  });

  describe('isNewPod', () => {
    test('returns true for pods under 60 seconds', () => {
      expect(isNewPod(0)).toBe(true);
      expect(isNewPod(30)).toBe(true);
      expect(isNewPod(59)).toBe(true);
    });

    test('returns false for pods 60 seconds or older', () => {
      expect(isNewPod(60)).toBe(false);
      expect(isNewPod(120)).toBe(false);
    });

    test('returns false for special values', () => {
      expect(isNewPod(9999)).toBe(false);
      expect(isNewPod(-1)).toBe(false);
    });
  });

  describe('formatSSEMessage', () => {
    test('formats object as SSE message', () => {
      const data = { status: 'ok', value: 42 };
      expect(formatSSEMessage(data)).toBe('data: {"status":"ok","value":42}\n\n');
    });

    test('handles empty object', () => {
      expect(formatSSEMessage({})).toBe('data: {}\n\n');
    });

    test('handles nested objects', () => {
      const data = { a: { b: { c: 1 } } };
      expect(formatSSEMessage(data)).toBe('data: {"a":{"b":{"c":1}}}\n\n');
    });
  });

  describe('createStressResult', () => {
    test('creates complete result', () => {
      const result = createStressResult(5000, 123.456, false, 'test-pod');
      expect(result.status).toBe('complete');
      expect(result.elapsed).toBe(5000);
      expect(result.result).toBe('123.46');
      expect(result.pod).toBe('test-pod');
    });

    test('creates stopped result', () => {
      const result = createStressResult(2000, 50.5, true, 'pod-1');
      expect(result.status).toBe('stopped');
    });
  });

  describe('createHealthResponse', () => {
    test('creates valid health response', () => {
      const response = createHealthResponse('my-pod');
      expect(response.status).toBe('healthy');
      expect(response.pod).toBe('my-pod');
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof response.pid).toBe('number');
      expect(typeof response.uptime).toBe('number');
      expect(typeof response.memory).toBe('object');
    });
  });

  describe('createStopResponse', () => {
    test('creates valid stop response', () => {
      const response = createStopResponse();
      expect(response.status).toBe('stopped');
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('createGenerateLoadResponse', () => {
    test('creates valid generate load response', () => {
      const response = createGenerateLoadResponse(['10.0.0.1'], 50, 6);
      expect(response.status).toBe('started');
      expect(response.targets).toEqual(['10.0.0.1']);
      expect(response.concurrency).toBe(50);
      expect(response.rounds).toBe(6);
    });
  });

  describe('createConcurrentTestError', () => {
    test('creates error response', () => {
      const response = createConcurrentTestError();
      expect(response.status).toBe('error');
      expect(response.message).toContain('already running');
    });
  });

  describe('createInternalStopResponse', () => {
    test('creates valid internal stop response', () => {
      const response = createInternalStopResponse();
      expect(response.status).toBe('stopped');
    });
  });

  describe('generatePodCardHtml', () => {
    test('generates valid pod card HTML with all fields', () => {
      const podInfo = {
        name: 'test-pod',
        namespace: 'default',
        phase: 'Running',
        ip: '10.0.0.1',
        ready: '1/1',
        restarts: 0,
        age: '5m'
      };
      const html = generatePodCardHtml(podInfo);
      expect(html).toContain('test-pod');
      expect(html).toContain('default');
      expect(html).toContain('Running');
      expect(html).toContain('10.0.0.1');
      expect(html).toContain('1/1');
      expect(html).toContain('5m');
      expect(html).toContain('class="card"');
      expect(html).toContain('class="status running"');
    });

    test('handles Pending phase with correct CSS class', () => {
      const podInfo = {
        name: 'pending-pod',
        namespace: 'kube-system',
        phase: 'Pending',
        ip: '-',
        ready: '0/1',
        restarts: 0,
        age: '10s'
      };
      const html = generatePodCardHtml(podInfo);
      expect(html).toContain('class="status pending"');
    });

    test('handles Failed phase with correct CSS class', () => {
      const podInfo = {
        name: 'failed-pod',
        namespace: 'default',
        phase: 'Failed',
        ip: '-',
        ready: '0/1',
        restarts: 5,
        age: '1h'
      };
      const html = generatePodCardHtml(podInfo);
      expect(html).toContain('class="status failed"');
      expect(html).toContain('Restarts: 5');
    });
  });

  describe('generatePodsPageHtml', () => {
    test('generates valid pods page HTML', () => {
      const cards = '<div class="card">Test Card</div>';
      const html = generatePodsPageHtml(cards);
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('<title>Pods</title>');
      expect(html).toContain('Pods (from kubectl)');
      expect(html).toContain('class="grid"');
      expect(html).toContain('Test Card');
      expect(html).toContain('kubeconfig');
    });

    test('includes all required CSS styles', () => {
      const html = generatePodsPageHtml('');
      expect(html).toContain('.card{');
      expect(html).toContain('.status.running{');
      expect(html).toContain('.status.pending{');
      expect(html).toContain('.status.failed{');
    });
  });

  describe('generatePodsErrorHtml', () => {
    test('generates error page with message', () => {
      const html = generatePodsErrorHtml('command not found');
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('kubectl failed: command not found');
      expect(html).toContain('kubeconfig');
      expect(html).toContain('Back');
    });

    test('escapes special characters in error message', () => {
      const html = generatePodsErrorHtml('Error with <script>');
      expect(html).toContain('Error with <script>');
    });
  });
});
