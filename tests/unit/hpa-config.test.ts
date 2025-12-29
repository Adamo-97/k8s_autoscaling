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

  describe('HPA scale-down behavior (optimized for faster cooldown)', () => {
    const getScaleDown = () => hpaConfig.spec.behavior.scaleDown;

    test('scale-down stabilization window is 30 seconds', () => {
      // Reduced from 60s to 30s for faster scale-down while still preventing oscillation
      expect(getScaleDown().stabilizationWindowSeconds).toBe(30);
    });

    test('scale-down uses Max selectPolicy (faster cooldown)', () => {
      // Max policy = faster scale-down = quicker return to baseline
      expect(getScaleDown().selectPolicy).toBe('Max');
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

    test('scale-down Percent policy allows up to 25%', () => {
      const percentPolicy = getScaleDown().policies.find(
        (p: any) => p.type === 'Percent'
      );
      if (percentPolicy) {
        // Scale down by up to 25% for faster cooldown
        expect(percentPolicy.value).toBe(25);
      }
    });
  });

  describe('HPA behavior asymmetry (scale-up fast, scale-down controlled)', () => {
    test('scale-up is faster than scale-down', () => {
      const scaleUp = hpaConfig.spec.behavior.scaleUp;
      const scaleDown = hpaConfig.spec.behavior.scaleDown;

      // Scale-up should have shorter stabilization
      expect(scaleUp.stabilizationWindowSeconds).toBeLessThan(
        scaleDown.stabilizationWindowSeconds
      );
    });

    test('both scale-up and scale-down use Max policy for speed', () => {
      // Both use Max for responsive scaling (fast up and fast down)
      expect(hpaConfig.spec.behavior.scaleUp.selectPolicy).toBe('Max');
      expect(hpaConfig.spec.behavior.scaleDown.selectPolicy).toBe('Max');
    });

    test('scale-down has controlled cooldown to prevent stuck state', () => {
      const scaleDown = hpaConfig.spec.behavior.scaleDown;
      
      // Key settings for responsive scale-down:
      // 1. 30s stabilization window (not too long)
      expect(scaleDown.stabilizationWindowSeconds).toBe(30);
      
      // 2. Reasonable scale-down rate (2 pods per period)
      const podsPolicy = scaleDown.policies.find((p: any) => p.type === 'Pods');
      expect(podsPolicy.value).toBe(2);
      
      // 3. 30s period between scale-down events
      expect(podsPolicy.periodSeconds).toBe(30);
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
