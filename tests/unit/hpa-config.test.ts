import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

describe('Kubernetes HPA Configuration Validation', () => {
  const hpaPath = path.join(__dirname, '../../k8s-hpa.yaml');
  let hpaConfig: any;

  beforeAll(() => {
    const content = fs.readFileSync(hpaPath, 'utf-8');
    hpaConfig = yaml.load(content);
  });

  describe('HPA metadata and structure', () => {
    test('HPA has correct API version', () => {
      expect(hpaConfig.apiVersion).toBe('autoscaling/v2');
    });

    test('HPA has correct kind', () => {
      expect(hpaConfig.kind).toBe('HorizontalPodAutoscaler');
    });

    test('HPA targets the correct deployment', () => {
      expect(hpaConfig.spec.scaleTargetRef.name).toBe('k8s-autoscaling-app');
      expect(hpaConfig.spec.scaleTargetRef.kind).toBe('Deployment');
    });
  });

  describe('HPA scaling limits', () => {
    test('minReplicas is set correctly', () => {
      expect(hpaConfig.spec.minReplicas).toBe(1);
    });

    test('maxReplicas is set to 10', () => {
      expect(hpaConfig.spec.maxReplicas).toBe(10);
    });

    test('maxReplicas is greater than minReplicas', () => {
      expect(hpaConfig.spec.maxReplicas).toBeGreaterThan(hpaConfig.spec.minReplicas);
    });
  });

  describe('HPA CPU metric configuration', () => {
    test('uses CPU resource metric', () => {
      const cpuMetric = hpaConfig.spec.metrics.find(
        (m: any) => m.type === 'Resource' && m.resource?.name === 'cpu'
      );
      expect(cpuMetric).toBeDefined();
    });

    test('CPU target is 50% utilization', () => {
      const cpuMetric = hpaConfig.spec.metrics.find(
        (m: any) => m.resource?.name === 'cpu'
      );
      expect(cpuMetric.resource.target.type).toBe('Utilization');
      expect(cpuMetric.resource.target.averageUtilization).toBe(50);
    });

    test('CPU target is reasonable (between 30% and 80%)', () => {
      const cpuMetric = hpaConfig.spec.metrics.find(
        (m: any) => m.resource?.name === 'cpu'
      );
      const target = cpuMetric.resource.target.averageUtilization;
      expect(target).toBeGreaterThanOrEqual(30);
      expect(target).toBeLessThanOrEqual(80);
    });
  });

  describe('HPA scale-up behavior', () => {
    const getScaleUp = () => hpaConfig.spec.behavior.scaleUp;

    test('scale-up stabilization window is 0 (immediate)', () => {
      expect(getScaleUp().stabilizationWindowSeconds).toBe(0);
    });

    test('scale-up uses Max selectPolicy (aggressive)', () => {
      expect(getScaleUp().selectPolicy).toBe('Max');
    });

    test('scale-up has Percent policy', () => {
      const percentPolicy = getScaleUp().policies.find(
        (p: any) => p.type === 'Percent'
      );
      expect(percentPolicy).toBeDefined();
      expect(percentPolicy.value).toBeGreaterThanOrEqual(50);
    });

    test('scale-up has Pods policy', () => {
      const podsPolicy = getScaleUp().policies.find(
        (p: any) => p.type === 'Pods'
      );
      expect(podsPolicy).toBeDefined();
      expect(podsPolicy.value).toBeGreaterThanOrEqual(1);
    });

    test('scale-up period is 15 seconds or less', () => {
      getScaleUp().policies.forEach((policy: any) => {
        expect(policy.periodSeconds).toBeLessThanOrEqual(15);
      });
    });
  });

  describe('HPA scale-down behavior (critical for preventing oscillation)', () => {
    const getScaleDown = () => hpaConfig.spec.behavior.scaleDown;

    test('scale-down stabilization window is at least 60 seconds', () => {
      // This prevents oscillation by requiring stable low CPU for 60s
      expect(getScaleDown().stabilizationWindowSeconds).toBeGreaterThanOrEqual(60);
    });

    test('scale-down uses Min selectPolicy (conservative)', () => {
      // Min policy = more conservative = less oscillation
      expect(getScaleDown().selectPolicy).toBe('Min');
    });

    test('scale-down has conservative Pods policy', () => {
      const podsPolicy = getScaleDown().policies.find(
        (p: any) => p.type === 'Pods'
      );
      expect(podsPolicy).toBeDefined();
      // Should only remove 1-2 pods at a time to prevent over-correction
      expect(podsPolicy.value).toBeLessThanOrEqual(2);
    });

    test('scale-down period is at least 30 seconds', () => {
      // Longer periods = slower scale-down = more stable
      getScaleDown().policies.forEach((policy: any) => {
        expect(policy.periodSeconds).toBeGreaterThanOrEqual(30);
      });
    });

    test('scale-down Percent policy is conservative (≤ 20%)', () => {
      const percentPolicy = getScaleDown().policies.find(
        (p: any) => p.type === 'Percent'
      );
      if (percentPolicy) {
        // Should only scale down by 10-20% at a time
        expect(percentPolicy.value).toBeLessThanOrEqual(20);
      }
    });
  });

  describe('HPA behavior asymmetry (scale-up fast, scale-down slow)', () => {
    test('scale-up is faster than scale-down', () => {
      const scaleUp = hpaConfig.spec.behavior.scaleUp;
      const scaleDown = hpaConfig.spec.behavior.scaleDown;

      // Scale-up should have shorter stabilization
      expect(scaleUp.stabilizationWindowSeconds).toBeLessThan(
        scaleDown.stabilizationWindowSeconds
      );
    });

    test('scale-up uses Max policy, scale-down uses Min', () => {
      expect(hpaConfig.spec.behavior.scaleUp.selectPolicy).toBe('Max');
      expect(hpaConfig.spec.behavior.scaleDown.selectPolicy).toBe('Min');
    });

    test('asymmetric behavior prevents oscillation', () => {
      const scaleDown = hpaConfig.spec.behavior.scaleDown;
      
      // Key anti-oscillation settings:
      // 1. Long stabilization window (60s+)
      expect(scaleDown.stabilizationWindowSeconds).toBeGreaterThanOrEqual(60);
      
      // 2. Conservative scale-down rate
      const podsPolicy = scaleDown.policies.find((p: any) => p.type === 'Pods');
      expect(podsPolicy.value).toBeLessThanOrEqual(2);
      
      // 3. Longer period between scale-down events
      expect(podsPolicy.periodSeconds).toBeGreaterThanOrEqual(30);
    });
  });

  describe('HPA best practices validation', () => {
    test('HPA targets deployment (not ReplicaSet)', () => {
      expect(hpaConfig.spec.scaleTargetRef.kind).toBe('Deployment');
    });

    test('minReplicas is at least 1 for availability', () => {
      expect(hpaConfig.spec.minReplicas).toBeGreaterThanOrEqual(1);
    });

    test('maxReplicas is reasonable (not too high)', () => {
      // For demo purposes, 10 is reasonable
      expect(hpaConfig.spec.maxReplicas).toBeLessThanOrEqual(20);
    });

    test('uses autoscaling/v2 for advanced features', () => {
      expect(hpaConfig.apiVersion).toContain('autoscaling/v2');
    });

    test('has explicit behavior configuration', () => {
      expect(hpaConfig.spec.behavior).toBeDefined();
      expect(hpaConfig.spec.behavior.scaleUp).toBeDefined();
      expect(hpaConfig.spec.behavior.scaleDown).toBeDefined();
    });
  });
});
