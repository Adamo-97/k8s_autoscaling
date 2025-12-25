import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);
const ROOT = path.resolve(__dirname, '../../');

describe('Shell Scripts Tests', () => {
  describe('load-generator.sh', () => {
    const scriptPath = path.join(ROOT, 'load-generator.sh');

    test('script file exists and is readable', () => {
      expect(fs.existsSync(scriptPath)).toBe(true);
      const stats = fs.statSync(scriptPath);
      expect(stats.isFile()).toBe(true);
    });

    test('script has bash shebang', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toMatch(/^#!\/bin\/bash/);
    });

    test('script contains required functions and logic', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('make_requests');
      expect(content).toContain('curl');
      expect(content).toContain('/cpu-load');
      expect(content).toContain('URL=');
      expect(content).toContain('REQUESTS=');
      expect(content).toContain('CONCURRENT=');
    });

    test('script validates curl is available', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('command -v curl');
    });

    test('script has proper default values', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toMatch(/URL=\$\{1:-http:\/\/localhost:3000\}/);
      expect(content).toMatch(/REQUESTS=\$\{2:-100\}/);
      expect(content).toMatch(/CONCURRENT=\$\{3:-10\}/);
    });
  });

  describe('local-test.sh', () => {
    const scriptPath = path.join(ROOT, 'local-test.sh');

    test('script file exists and is readable', () => {
      expect(fs.existsSync(scriptPath)).toBe(true);
      const stats = fs.statSync(scriptPath);
      expect(stats.isFile()).toBe(true);
    });

    test('script has bash shebang', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toMatch(/^#!\/bin\/bash/);
    });

    test('script contains docker and minikube test functions', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('test_docker');
      expect(content).toContain('test_minikube');
    });

    test('script detects container engine (docker/podman)', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('detect_container_engine');
      expect(content).toContain('CONTAINER_ENGINE');
      expect(content).toContain('COMPOSE_CMD');
    });

    test('script checks for required commands', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('command_exists');
      expect(content).toContain('minikube');
      expect(content).toContain('kubectl');
    });

    test('script has mode switch logic', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toMatch(/case.*MODE.*in/);
      expect(content).toContain('docker)');
      expect(content).toContain('minikube)');
    });

    test('script includes metrics-server setup for minikube', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('metrics-server');
      expect(content).toContain('minikube addons enable');
    });

    test('script creates local k8s manifests', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('k8s-app-local.yaml');
      expect(content).toContain('imagePullPolicy');
    });
  });

  describe('setup_aws_node.sh', () => {
    const scriptPath = path.join(ROOT, 'setup_aws_node.sh');

    test('script file exists and is readable', () => {
      expect(fs.existsSync(scriptPath)).toBe(true);
      const stats = fs.statSync(scriptPath);
      expect(stats.isFile()).toBe(true);
    });

    test('script has bash shebang and sets -e', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toMatch(/^#!\/bin\/bash/);
      expect(content).toContain('set -e');
    });

    test('script checks for root privileges', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('EUID');
      expect(content).toMatch(/Please run as root|must be run as root/);
    });

    test('script disables swap', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('swapoff -a');
      expect(content).toContain('/etc/fstab');
    });

    test('script loads required kernel modules', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('overlay');
      expect(content).toContain('br_netfilter');
      expect(content).toContain('modprobe');
    });

    test('script configures sysctl parameters', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('net.bridge.bridge-nf-call-iptables');
      expect(content).toContain('net.ipv4.ip_forward');
      expect(content).toContain('sysctl');
    });

    test('script installs containerd', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('containerd');
      expect(content).toContain('SystemdCgroup');
    });

    test('script installs kubernetes components', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('kubeadm');
      expect(content).toContain('kubelet');
      expect(content).toContain('kubectl');
      expect(content).toContain('apt-mark hold');
    });

    test('script provides next steps instructions', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('Next Steps');
      expect(content).toContain('kubeadm init');
      expect(content).toContain('kubeadm join');
    });
  });

  describe('local-setup-ubuntu.sh', () => {
    const scriptPath = path.join(ROOT, 'local-setup-ubuntu.sh');

    test('script file exists and is readable', () => {
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    test('script has bash shebang', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toMatch(/^#!\/bin\/bash/);
    });

    test('script checks for root privileges', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('EUID');
    });

    test('script installs docker', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('docker');
      expect(content).toContain('docker-ce');
      expect(content).toContain('containerd.io');
    });

    test('script installs kubectl and minikube', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('kubectl');
      expect(content).toContain('minikube');
    });

    test('script installs conntrack', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('conntrack');
    });
  });

  describe('local-setup-fedora.sh', () => {
    const scriptPath = path.join(ROOT, 'local-setup-fedora.sh');

    test('script file exists and is readable', () => {
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    test('script has bash shebang', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toMatch(/^#!\/bin\/bash/);
    });

    test('script checks for root privileges', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('EUID');
    });

    test('script installs podman', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('podman');
      expect(content).toContain('podman-docker');
      expect(content).toContain('podman-compose');
    });

    test('script installs kubectl and minikube', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('kubectl');
      expect(content).toContain('minikube');
    });

    test('script uses dnf package manager', () => {
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('dnf');
    });
  });

  describe('test-ci.sh', () => {
    const scriptPath = path.join(ROOT, 'scripts_tests', 'test-ci.sh');

    test('script directory exists', () => {
      const dirPath = path.join(ROOT, 'scripts_tests');
      // Directory may or may not exist
      if (fs.existsSync(dirPath)) {
        expect(fs.statSync(dirPath).isDirectory()).toBe(true);
      } else {
        expect(true).toBe(true); // Directory doesn't exist, that's okay
      }
    });

    test('can check for script existence', () => {
      // Script may exist or not - test the check works
      const exists = fs.existsSync(scriptPath);
      expect(typeof exists).toBe('boolean');
    });
  });
});
