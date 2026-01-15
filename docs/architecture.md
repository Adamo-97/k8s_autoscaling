# Architecture Reference

This document provides detailed architecture diagrams and technical explanations for the Kubernetes Autoscaling Demo project.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Deployment Workflow](#deployment-workflow)
3. [HPA Decision Loop](#hpa-decision-loop)
4. [Network Communication Flow](#network-communication-flow)
5. [AWS Infrastructure Architecture](#aws-infrastructure-architecture)

---

## System Architecture

This diagram depicts the flow of user requests through the Kubernetes cluster and the feedback loop that enables autoscaling.

```mermaid
flowchart TB
    subgraph External["External Network"]
        User["User Browser/Client"]
    end

    subgraph AWS["AWS EC2 Infrastructure"]
        subgraph Master["Control Plane Node (t3.medium)"]
            API["kube-apiserver"]
            Scheduler["kube-scheduler"]
            CM["kube-controller-manager"]
            ETCD["etcd"]
            HPA["HPA Controller"]
            MS["Metrics Server"]
        end

        subgraph Workers["Worker Nodes (t3.medium x2)"]
            subgraph Worker1["Worker Node 1"]
                K1["kubelet"]
                P1["Pod Replica 1"]
                P2["Pod Replica 2"]
            end
            subgraph Worker2["Worker Node 2"]
                K2["kubelet"]
                P3["Pod Replica 3"]
                P4["Pod Replica N"]
            end
        end

        SVC["NodePort Service\nPort 30080"]
    end

    User -->|"HTTP Request\nPort 30080"| SVC
    SVC -->|"Load Distribution"| P1
    SVC -->|"Load Distribution"| P2
    SVC -->|"Load Distribution"| P3
    SVC -->|"Load Distribution"| P4

    K1 -->|"Report Metrics"| MS
    K2 -->|"Report Metrics"| MS
    MS -->|"Expose Metrics API"| HPA
    HPA -->|"Query Current Usage"| MS
    HPA -->|"Scale Decision"| API
    API -->|"Create/Delete Pods"| Scheduler
    Scheduler -->|"Assign Pods"| K1
    Scheduler -->|"Assign Pods"| K2
```

---

## Deployment Workflow

This sequence diagram illustrates the complete deployment pipeline from local development to production operation.

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Developer Workstation
    participant Docker as Docker Hub Registry
    participant AWS as AWS Console
    participant Master as Control Plane Node
    participant Worker as Worker Nodes
    participant K8s as Kubernetes API

    rect rgb(240, 248, 255)
        Note over Dev,Docker: Phase 1 - Build and Registry
        Dev->>Dev: npm run build (TypeScript compilation)
        Dev->>Dev: docker build -t image:tag .
        Dev->>Dev: docker run (local validation)
        Dev->>Docker: docker push image:tag
    end

    rect rgb(255, 248, 240)
        Note over AWS,Worker: Phase 2 - Infrastructure Provisioning
        Dev->>AWS: Launch 3x EC2 t3.medium instances
        Dev->>AWS: Configure Security Groups
        AWS->>Master: Provision Control Plane
        AWS->>Worker: Provision Worker Nodes
    end

    rect rgb(240, 255, 240)
        Note over Master,K8s: Phase 3 - Cluster Initialization
        Dev->>Master: SSH and execute setup_aws_node.sh
        Dev->>Worker: SSH and execute setup_aws_node.sh
        Master->>Master: kubeadm init
        Master->>Master: Install Calico CNI
        Master->>Master: Install Metrics Server
        Worker->>Master: kubeadm join
        Master->>K8s: Cluster Ready
    end

    rect rgb(248, 240, 255)
        Note over K8s,K8s: Phase 4 - Application Deployment
        Dev->>K8s: kubectl apply -f k8s-app.yaml
        Dev->>K8s: kubectl apply -f k8s-hpa.yaml
        K8s->>K8s: Deploy initial replica
        K8s->>K8s: HPA monitoring active
    end
```

---

## HPA Decision Loop

This diagram illustrates the continuous feedback loop that governs autoscaling decisions.

```mermaid
flowchart LR
    subgraph Monitoring["Metrics Collection (Every 15s)"]
        MS["Metrics Server"]
        K["Kubelet"]
    end

    subgraph Decision["HPA Controller"]
        Calc["Calculate:\ndesiredReplicas = ceil(currentReplicas * (currentMetric / targetMetric))"]
        Compare["Compare with\nmin/max bounds"]
    end

    subgraph Action["Scaling Action"]
        Scale["Update Deployment\nreplica count"]
        Wait["Stabilization\nWindow"]
    end

    K -->|"CPU/Memory\nUsage Data"| MS
    MS -->|"Aggregated\nMetrics"| Calc
    Calc --> Compare
    Compare -->|"Scale Up"| Scale
    Compare -->|"Scale Down"| Wait
    Wait -->|"After cooldown"| Scale
    Scale -->|"New pods\nreport metrics"| K
```

### HPA Scaling Formula

The HPA uses this formula to calculate desired replicas:

```
desiredReplicas = ceil(currentReplicas * (currentCPU / targetCPU))
```

**Example:** If current replicas = 2, current CPU = 75%, target CPU = 50%:

```
desiredReplicas = ceil(2 * (75% / 50%)) = ceil(3) = 3 replicas
```

---

## Network Communication Flow

This diagram details the network ports and protocols required for cluster communication.

```mermaid
flowchart TB
    subgraph External["External Traffic"]
        Client["Client"]
    end

    subgraph ControlPlane["Control Plane Ports"]
        API6443["API Server\n:6443/TCP"]
        ETCD2379["etcd\n:2379-2380/TCP"]
        Sched10259["Scheduler\n:10259/TCP"]
        CM10257["Controller Manager\n:10257/TCP"]
    end

    subgraph WorkerPorts["Worker Node Ports"]
        Kubelet10250["Kubelet\n:10250/TCP"]
        NodePort["NodePort Range\n:30000-32767/TCP"]
    end

    subgraph CNIPorts["CNI (Calico) Ports"]
        BGP179["BGP\n:179/TCP"]
        VXLAN4789["VXLAN\n:4789/UDP"]
    end

    Client -->|"Application Traffic"| NodePort
    API6443 <-->|"Cluster Management"| Kubelet10250
    API6443 <-->|"State Storage"| ETCD2379
    Kubelet10250 <-->|"Pod Networking"| BGP179
    Kubelet10250 <-->|"Overlay Network"| VXLAN4789
```

---

## AWS Infrastructure Architecture

This diagram illustrates the AWS resources created by `deploy_infra.sh` and how security group rules control access.

```mermaid
flowchart TB
    subgraph Internet["Internet"]
        User["Your Workstation<br/>IP: xxx.xxx.xxx.xxx"]
        PublicUsers["Public Users<br/>(Dashboard Access)"]
    end

    subgraph AWS["AWS Cloud - Region: us-east-1"]
        subgraph SecurityGroup["Security Group: k8s-autoscaling-demo-sg"]
            direction TB
            SG_Rules["Security Group Rules:<br/>━━━━━━━━━━━━━━━━━<br/>✓ SSH (22) ← Your IP/32<br/>✓ NodePort (30080) ← 0.0.0.0/0<br/>✓ All Traffic ← Self-Reference"]
        end

        subgraph VPC["Default VPC"]
            subgraph Subnet["Default Subnet"]
                EC2_1["EC2 Instance 1<br/>t3.medium<br/>━━━━━━━━━━━<br/>Public IP: 54.x.x.1<br/>Private IP: 172.31.x.1<br/>Role: Control Plane<br/>━━━━━━━━━━━<br/>Components:<br/>• kubeadm/kubelet<br/>• containerd<br/>• Calico CNI"]
                EC2_2["EC2 Instance 2<br/>t3.medium<br/>━━━━━━━━━━━<br/>Public IP: 54.x.x.2<br/>Private IP: 172.31.x.2<br/>Role: Worker Node<br/>━━━━━━━━━━━<br/>Components:<br/>• kubelet<br/>• containerd<br/>• Application Pods"]
                EC2_3["EC2 Instance 3<br/>t3.medium<br/>━━━━━━━━━━━<br/>Public IP: 54.x.x.3<br/>Private IP: 172.31.x.3<br/>Role: Worker Node<br/>━━━━━━━━━━━<br/>Components:<br/>• kubelet<br/>• containerd<br/>• Application Pods"]
            end
        end

        KeyPair["SSH Key Pair<br/>k8s-autoscaling-demo-key<br/>━━━━━━━━━━━<br/>Private Key: .pem file<br/>(stored locally)"]
    end

    subgraph LocalMachine["Local Machine"]
        KeyFile["k8s-autoscaling-demo-key.pem<br/>(chmod 400)"]
        DeployScript["deploy_infra.sh"]
        TeardownScript["teardown_infra.sh"]
    end

    %% Security Group Connections
    User -->|"SSH (Port 22)"| SG_Rules
    PublicUsers -->|"HTTP (Port 30080)"| SG_Rules

    SG_Rules -.->|"Protects"| EC2_1
    SG_Rules -.->|"Protects"| EC2_2
    SG_Rules -.->|"Protects"| EC2_3

    %% Internal Communication (Self-Reference Rule)
    EC2_1 <-->|"Kubernetes API (6443)<br/>etcd (2379-2380)<br/>kubelet (10250)<br/>Calico BGP (179)"| EC2_2
    EC2_1 <-->|"All Cluster Traffic"| EC2_3
    EC2_2 <-->|"Pod-to-Pod Traffic"| EC2_3

    %% Key Pair Usage
    KeyPair -.->|"Authenticates"| EC2_1
    KeyPair -.->|"Authenticates"| EC2_2
    KeyPair -.->|"Authenticates"| EC2_3
    KeyFile -.->|"Corresponds to"| KeyPair

    %% Script Actions
    DeployScript -->|"Creates"| SecurityGroup
    DeployScript -->|"Creates"| KeyPair
    DeployScript -->|"Launches"| EC2_1
    DeployScript -->|"Launches"| EC2_2
    DeployScript -->|"Launches"| EC2_3

    TeardownScript -.->|"Terminates"| EC2_1
    TeardownScript -.->|"Terminates"| EC2_2
    TeardownScript -.->|"Terminates"| EC2_3
    TeardownScript -.->|"Deletes"| SecurityGroup
    TeardownScript -.->|"Deletes"| KeyPair

    classDef awsResource fill:#FF9900,stroke:#232F3E,stroke-width:2px,color:#232F3E
    classDef securityResource fill:#DD344C,stroke:#232F3E,stroke-width:2px,color:#fff
    classDef localResource fill:#4A90E2,stroke:#232F3E,stroke-width:2px,color:#fff

    class EC2_1,EC2_2,EC2_3 awsResource
    class SecurityGroup,SG_Rules,KeyPair securityResource
    class DeployScript,TeardownScript,KeyFile localResource
```

### Key Infrastructure Components

1. **Security Group** (`k8s-autoscaling-demo-sg`):

   - Acts as a virtual firewall for all instances
   - Three types of rules:
     - **SSH (22)**: Restricted to your public IP for administrative access
     - **NodePort (30080)**: Open to the internet for dashboard access
     - **Self-Reference**: Allows all traffic between instances (enables Kubernetes cluster communication)

2. **EC2 Instances** (3x t3.medium):

   - Each instance has public IP (for external access) and private IP (for internal communication)
   - All instances share the same security group
   - User data script automatically installs Kubernetes components on first boot

3. **SSH Key Pair** (`k8s-autoscaling-demo-key`):

   - Created by `deploy_infra.sh` and saved locally as `.pem` file
   - Used to authenticate SSH connections to all instances
   - Private key never leaves your local machine

4. **Internal Communication**:

   - Self-referencing security group rule enables all instances to communicate freely
   - Required for Kubernetes control plane communication (API server, etcd, kubelet)
   - Required for pod networking via Calico CNI

5. **Deployment Scripts**:
   - `deploy_infra.sh`: Creates all AWS resources in correct order
   - `teardown_infra.sh`: Safely destroys all resources to prevent charges

### Security Model

- **External Access**: Only SSH (from your IP) and NodePort 30080 (public) are exposed
- **Internal Access**: All ports open between cluster nodes for Kubernetes operation
- **Authentication**: SSH key pair required for terminal access
- **Isolation**: VPC and security group provide network isolation from other AWS resources

---

## Technical Glossary

| Term                                  | Definition                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **NodePort**                          | A Kubernetes Service type that exposes an application on a static port (range 30000-32767) on every node in the cluster. External traffic can reach the application by connecting to any node's IP address on the designated port.                                                                     |
| **Horizontal Pod Autoscaler (HPA)**   | A Kubernetes controller that automatically adjusts the number of pod replicas in a deployment based on observed metrics (typically CPU or memory utilization). The HPA increases replicas when demand rises and decreases them when demand falls.                                                      |
| **Kubelet**                           | The primary node agent that runs on every worker node in the cluster. It ensures that containers described in PodSpecs are running and healthy. The kubelet communicates with the control plane to receive instructions and report node status.                                                        |
| **CNI (Container Network Interface)** | A specification and set of libraries for configuring network interfaces in Linux containers. In Kubernetes, CNI plugins (such as Calico, Flannel, or Weave) provide pod-to-pod networking across nodes.                                                                                                |
| **SystemdCgroup**                     | A configuration option for container runtimes that delegates cgroup (control group) management to systemd rather than the container runtime itself. This ensures consistency with how Kubernetes manages resource allocation and is required when using systemd as the init system.                    |
| **Swap Memory**                       | A portion of disk storage used as virtual memory when physical RAM is exhausted. Kubernetes requires swap to be disabled because the scheduler assumes predictable memory availability; swap introduces latency and unpredictable performance that conflicts with Quality of Service (QoS) guarantees. |
| **Metrics Server**                    | A cluster-wide aggregator of resource usage data. It collects CPU and memory metrics from kubelets and exposes them through the Kubernetes API. The HPA relies on Metrics Server data to make scaling decisions.                                                                                       |
| **Control Plane**                     | The set of components that manage the overall state of the cluster, including the API server, scheduler, controller manager, and etcd. The control plane makes global decisions about the cluster and detects and responds to cluster events.                                                          |
| **etcd**                              | A distributed key-value store that serves as the backing store for all Kubernetes cluster data. It stores configuration data, state, and metadata that the control plane requires to function.                                                                                                         |
| **Calico**                            | A CNI plugin that provides networking and network policy enforcement for Kubernetes. It uses BGP (Border Gateway Protocol) to route traffic between nodes without encapsulation, offering high performance.                                                                                            |
