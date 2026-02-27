# Kubernetes Admission Webhook

The AumOS governance admission webhook is a `ValidatingWebhook` that rejects
AI agent Pods from entering a cluster unless they declare the required
governance annotations. Validation is entirely static — no behavioral scoring,
no adaptive decisions.

## How it works

When a Pod is created or updated in a namespace labelled
`aumos.ai/governance: enabled`, the Kubernetes API server sends an
`AdmissionReview` (admission.k8s.io/v1) POST request to the webhook server.
The server inspects the Pod's `metadata.annotations`, runs
`ValidateGovernanceAnnotations`, and returns `allowed: true` or `allowed: false`
with a structured denial reason.

If the webhook server is unreachable the API server applies `failurePolicy: Fail`
and rejects the Pod. This is intentional — a silent failure would allow
unannotated Pods to slip through.

## Quick start with cert-manager

### 1. Install cert-manager

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
kubectl wait --for=condition=Available deployment --all -n cert-manager --timeout=120s
```

### 2. Create a self-signed ClusterIssuer

```bash
kubectl apply -f - <<'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned-issuer
spec:
  selfSigned: {}
EOF
```

### 3. Deploy the webhook server

```bash
kubectl apply -f packages/governance-go/k8s/manifests/deployment.yaml
kubectl -n aumos-system wait --for=condition=Available deployment/aumos-governance-webhook --timeout=60s
```

### 4. Register the webhook with the API server

```bash
kubectl apply -f packages/governance-go/k8s/manifests/webhook-config.yaml
```

### 5. Label a namespace to enable governance enforcement

```bash
kubectl label namespace my-agents aumos.ai/governance=enabled
```

Pods created in `my-agents` will now be validated by the webhook.

## Required annotations reference

Every Pod admitted into a governed namespace must carry all four annotations
below (unless `RequiredAnnotations` is restricted in the webhook configuration).

| Annotation | Type | Valid values | Example |
|---|---|---|---|
| `aumos.ai/trust-level` | integer string | `"0"` through `"5"` | `"2"` |
| `aumos.ai/budget-limit` | `<amount><CURRENCY>` | Positive integer + 3-letter ISO 4217 | `"500USD"` |
| `aumos.ai/consent-policy` | enum string | `explicit`, `implicit`, `delegated`, `none` | `"explicit"` |
| `aumos.ai/audit-enabled` | boolean string | `"true"` or `"false"` | `"true"` |

Trust levels map to the AumOS six-level trust hierarchy:

| Value | Name |
|---|---|
| `0` | Observer |
| `1` | Monitor |
| `2` | Suggest |
| `3` | Act-with-Approval |
| `4` | Act-and-Report |
| `5` | Autonomous |

Trust level is a **declaration** made by the operator, not a computed score.
The webhook validates only that the declared value is a valid integer in range.

## Example Pod with governance annotations

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: summariser-agent
  namespace: my-agents
  annotations:
    aumos.ai/trust-level: "2"
    aumos.ai/budget-limit: "100USD"
    aumos.ai/consent-policy: "explicit"
    aumos.ai/audit-enabled: "true"
spec:
  containers:
    - name: agent
      image: my-registry/summariser-agent:v1.2.0
      resources:
        requests:
          cpu: "100m"
          memory: "128Mi"
        limits:
          cpu: "500m"
          memory: "256Mi"
```

## Webhook server flags

| Flag | Default | Description |
|---|---|---|
| `-port` | `8443` | TCP port the HTTPS server listens on |
| `-cert` | _(required)_ | Path to TLS certificate PEM file |
| `-key` | _(required)_ | Path to TLS private key PEM file |
| `-required-annotations` | all four keys | Comma-separated list of annotation keys to enforce |

To enforce only a subset of annotations:

```bash
webhook -port 8443 \
        -cert /tls/tls.crt \
        -key  /tls/tls.key \
        -required-annotations "aumos.ai/trust-level,aumos.ai/audit-enabled"
```

## Troubleshooting

### Pod is rejected with "missing required governance annotation"

The Pod does not have the required annotation. Add all four governance
annotations to `metadata.annotations` in your Pod spec or PodTemplate.

```bash
# Inspect what annotations are present on a running pod
kubectl get pod <pod-name> -o jsonpath='{.metadata.annotations}' | jq
```

### Pod is rejected with "out of range" trust-level

The `aumos.ai/trust-level` annotation value must be a string containing a
decimal integer between `0` and `5`. Values like `"6"`, `"high"`, or `"2.5"`
are rejected.

### Pod is rejected with "invalid format" budget-limit

The `aumos.ai/budget-limit` annotation must match `<positive-integer><3-UPPERCASE-LETTERS>`,
for example `"100USD"` or `"2500EUR"`. Lowercase currencies (`"100usd"`),
zero amounts (`"0USD"`), and decimals (`"10.5USD"`) are rejected.

### Webhook server is unreachable (failurePolicy: Fail)

All Pods in governed namespaces will be denied when the webhook is down.
Check that the Deployment is healthy:

```bash
kubectl -n aumos-system get pods -l app.kubernetes.io/name=aumos-governance-webhook
kubectl -n aumos-system logs -l app.kubernetes.io/name=aumos-governance-webhook
```

Verify the TLS secret was created by cert-manager:

```bash
kubectl -n aumos-system get secret aumos-governance-webhook-tls
```

### Inspecting admission decisions in logs

Every admission decision is written at `INFO` level as structured JSON. Use
`kubectl logs` or your log aggregator to filter webhook decisions:

```bash
kubectl -n aumos-system logs -l app.kubernetes.io/name=aumos-governance-webhook \
  | jq 'select(.msg == "admission: decision")'
```

Key fields in each log entry:

| Field | Description |
|---|---|
| `uid` | The AdmissionRequest UID — correlates with the API server audit log |
| `operation` | `CREATE` or `UPDATE` |
| `pod_name` | Name of the Pod being admitted |
| `pod_namespace` | Namespace of the Pod |
| `allowed` | `true` or `false` |
| `reason` | Human-readable explanation of the decision |
