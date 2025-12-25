import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../');

describe('TypeScript Configuration Tests', () => {
  describe('tsconfig.json', () => {
    test('tsconfig.json exists', () => {
      const tsconfigPath = path.join(ROOT, 'tsconfig.json');
      expect(fs.existsSync(tsconfigPath)).toBe(true);
    });

    test('tsconfig.json is valid JSON', () => {
      const tsconfigPath = path.join(ROOT, 'tsconfig.json');
      const content = fs.readFileSync(tsconfigPath, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    test('tsconfig includes compilerOptions', () => {
      const tsconfigPath = path.join(ROOT, 'tsconfig.json');
      const content = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
      expect(content).toHaveProperty('compilerOptions');
    });
  });

  describe('package.json', () => {
    test('package.json exists', () => {
      const pkgPath = path.join(ROOT, 'package.json');
      expect(fs.existsSync(pkgPath)).toBe(true);
    });

    test('package.json is valid JSON', () => {
      const pkgPath = path.join(ROOT, 'package.json');
      const content = fs.readFileSync(pkgPath, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    test('package.json includes required scripts', () => {
      const pkgPath = path.join(ROOT, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.scripts).toHaveProperty('build');
      expect(pkg.scripts).toHaveProperty('start');
      expect(pkg.scripts).toHaveProperty('test');
    });

    test('package.json includes express dependency', () => {
      const pkgPath = path.join(ROOT, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.dependencies).toHaveProperty('express');
    });

    test('package.json includes kubernetes client', () => {
      const pkgPath = path.join(ROOT, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.dependencies).toHaveProperty('@kubernetes/client-node');
    });
  });

  describe('jest.config.ts', () => {
    test('jest.config.ts exists', () => {
      const jestPath = path.join(ROOT, 'jest.config.ts');
      expect(fs.existsSync(jestPath)).toBe(true);
    });

    test('jest config uses ts-jest preset', () => {
      const jestPath = path.join(ROOT, 'jest.config.ts');
      const content = fs.readFileSync(jestPath, 'utf-8');
      expect(content).toContain('ts-jest');
    });

    test('jest config sets testEnvironment to node', () => {
      const jestPath = path.join(ROOT, 'jest.config.ts');
      const content = fs.readFileSync(jestPath, 'utf-8');
      expect(content).toContain('node');
    });
  });
});

describe('Docker Configuration Tests', () => {
  describe('Dockerfile', () => {
    test('Dockerfile exists', () => {
      const dockerfilePath = path.join(ROOT, 'Dockerfile');
      expect(fs.existsSync(dockerfilePath)).toBe(true);
    });

    test('Dockerfile uses Node.js base image', () => {
      const dockerfilePath = path.join(ROOT, 'Dockerfile');
      const content = fs.readFileSync(dockerfilePath, 'utf-8');
      expect(content).toMatch(/FROM node:/i);
    });

    test('Dockerfile sets working directory', () => {
      const dockerfilePath = path.join(ROOT, 'Dockerfile');
      const content = fs.readFileSync(dockerfilePath, 'utf-8');
      expect(content).toMatch(/WORKDIR/i);
    });

    test('Dockerfile copies package files', () => {
      const dockerfilePath = path.join(ROOT, 'Dockerfile');
      const content = fs.readFileSync(dockerfilePath, 'utf-8');
      expect(content).toMatch(/COPY.*package.*\.json/i);
    });

    test('Dockerfile runs npm install', () => {
      const dockerfilePath = path.join(ROOT, 'Dockerfile');
      const content = fs.readFileSync(dockerfilePath, 'utf-8');
      expect(content).toMatch(/npm.*ci|npm.*install/i);
    });

    test('Dockerfile exposes port', () => {
      const dockerfilePath = path.join(ROOT, 'Dockerfile');
      const content = fs.readFileSync(dockerfilePath, 'utf-8');
      expect(content).toMatch(/EXPOSE/i);
    });

    test('Dockerfile has CMD or ENTRYPOINT', () => {
      const dockerfilePath = path.join(ROOT, 'Dockerfile');
      const content = fs.readFileSync(dockerfilePath, 'utf-8');
      expect(content).toMatch(/CMD|ENTRYPOINT/i);
    });
  });

  describe('docker-compose.yml', () => {
    test('docker-compose.yml exists', () => {
      const composePath = path.join(ROOT, 'docker-compose.yml');
      expect(fs.existsSync(composePath)).toBe(true);
    });

    test('docker-compose defines services', () => {
      const composePath = path.join(ROOT, 'docker-compose.yml');
      const content = fs.readFileSync(composePath, 'utf-8');
      expect(content).toMatch(/services:/i);
    });

    test('docker-compose maps ports', () => {
      const composePath = path.join(ROOT, 'docker-compose.yml');
      const content = fs.readFileSync(composePath, 'utf-8');
      expect(content).toMatch(/ports:/i);
    });
  });
});

describe('Kubernetes Configuration Tests', () => {
  describe('k8s-app.yaml', () => {
    test('k8s-app.yaml exists', () => {
      const k8sPath = path.join(ROOT, 'k8s-app.yaml');
      expect(fs.existsSync(k8sPath)).toBe(true);
    });

    test('k8s-app defines Deployment', () => {
      const k8sPath = path.join(ROOT, 'k8s-app.yaml');
      const content = fs.readFileSync(k8sPath, 'utf-8');
      expect(content).toMatch(/kind:\s*Deployment/i);
    });

    test('k8s-app defines Service', () => {
      const k8sPath = path.join(ROOT, 'k8s-app.yaml');
      const content = fs.readFileSync(k8sPath, 'utf-8');
      expect(content).toMatch(/kind:\s*Service/i);
    });

    test('k8s-app has apiVersion', () => {
      const k8sPath = path.join(ROOT, 'k8s-app.yaml');
      const content = fs.readFileSync(k8sPath, 'utf-8');
      expect(content).toMatch(/apiVersion:/i);
    });

    test('k8s-app includes container spec', () => {
      const k8sPath = path.join(ROOT, 'k8s-app.yaml');
      const content = fs.readFileSync(k8sPath, 'utf-8');
      expect(content).toMatch(/containers:/i);
    });

    test('k8s-app has resource limits', () => {
      const k8sPath = path.join(ROOT, 'k8s-app.yaml');
      const content = fs.readFileSync(k8sPath, 'utf-8');
      expect(content).toMatch(/resources:/i);
    });
  });

  describe('k8s-hpa.yaml', () => {
    test('k8s-hpa.yaml exists', () => {
      const hpaPath = path.join(ROOT, 'k8s-hpa.yaml');
      expect(fs.existsSync(hpaPath)).toBe(true);
    });

    test('k8s-hpa defines HorizontalPodAutoscaler', () => {
      const hpaPath = path.join(ROOT, 'k8s-hpa.yaml');
      const content = fs.readFileSync(hpaPath, 'utf-8');
      expect(content).toMatch(/kind:\s*HorizontalPodAutoscaler/i);
    });

    test('k8s-hpa has minReplicas', () => {
      const hpaPath = path.join(ROOT, 'k8s-hpa.yaml');
      const content = fs.readFileSync(hpaPath, 'utf-8');
      expect(content).toMatch(/minReplicas:/i);
    });

    test('k8s-hpa has maxReplicas', () => {
      const hpaPath = path.join(ROOT, 'k8s-hpa.yaml');
      const content = fs.readFileSync(hpaPath, 'utf-8');
      expect(content).toMatch(/maxReplicas:/i);
    });

    test('k8s-hpa has metrics', () => {
      const hpaPath = path.join(ROOT, 'k8s-hpa.yaml');
      const content = fs.readFileSync(hpaPath, 'utf-8');
      expect(content).toMatch(/metrics:/i);
    });
  });

  describe('k8s-rbac.yaml', () => {
    test('k8s-rbac.yaml exists', () => {
      const rbacPath = path.join(ROOT, 'k8s-rbac.yaml');
      expect(fs.existsSync(rbacPath)).toBe(true);
    });

    test('k8s-rbac defines ServiceAccount', () => {
      const rbacPath = path.join(ROOT, 'k8s-rbac.yaml');
      const content = fs.readFileSync(rbacPath, 'utf-8');
      expect(content).toMatch(/kind:\s*ServiceAccount/i);
    });

    test('k8s-rbac defines Role or ClusterRole', () => {
      const rbacPath = path.join(ROOT, 'k8s-rbac.yaml');
      const content = fs.readFileSync(rbacPath, 'utf-8');
      expect(content).toMatch(/kind:\s*(Cluster)?Role/i);
    });

    test('k8s-rbac defines RoleBinding or ClusterRoleBinding', () => {
      const rbacPath = path.join(ROOT, 'k8s-rbac.yaml');
      const content = fs.readFileSync(rbacPath, 'utf-8');
      expect(content).toMatch(/kind:\s*(Cluster)?RoleBinding/i);
    });
  });
});

describe('Documentation Tests', () => {
  describe('README.md', () => {
    test('README.md exists', () => {
      const readmePath = path.join(ROOT, 'README.md');
      expect(fs.existsSync(readmePath)).toBe(true);
    });

    test('README has content', () => {
      const readmePath = path.join(ROOT, 'README.md');
      const content = fs.readFileSync(readmePath, 'utf-8');
      expect(content.length).toBeGreaterThan(100);
    });

    test('README includes Kubernetes or k8s', () => {
      const readmePath = path.join(ROOT, 'README.md');
      const content = fs.readFileSync(readmePath, 'utf-8');
      expect(content).toMatch(/kubernetes|k8s/i);
    });
  });

  describe('LICENSE', () => {
    test('LICENSE file exists', () => {
      const licensePath = path.join(ROOT, 'LICENSE');
      expect(fs.existsSync(licensePath)).toBe(true);
    });

    test('LICENSE has content', () => {
      const licensePath = path.join(ROOT, 'LICENSE');
      const content = fs.readFileSync(licensePath, 'utf-8');
      expect(content.length).toBeGreaterThan(50);
    });
  });
});

describe('Project Structure Tests', () => {
  test('src directory exists', () => {
    const srcPath = path.join(ROOT, 'src');
    expect(fs.existsSync(srcPath)).toBe(true);
    expect(fs.statSync(srcPath).isDirectory()).toBe(true);
  });

  test('tests directory exists', () => {
    const testsPath = path.join(ROOT, 'tests');
    expect(fs.existsSync(testsPath)).toBe(true);
    expect(fs.statSync(testsPath).isDirectory()).toBe(true);
  });

  test('server.ts exists in src', () => {
    const serverPath = path.join(ROOT, 'src', 'server.ts');
    expect(fs.existsSync(serverPath)).toBe(true);
  });

  test('integration tests directory exists', () => {
    const integrationPath = path.join(ROOT, 'tests', 'integration');
    expect(fs.existsSync(integrationPath)).toBe(true);
    expect(fs.statSync(integrationPath).isDirectory()).toBe(true);
  });

  test('unit tests directory exists', () => {
    const unitPath = path.join(ROOT, 'tests', 'unit');
    expect(fs.existsSync(unitPath)).toBe(true);
    expect(fs.statSync(unitPath).isDirectory()).toBe(true);
  });
});
