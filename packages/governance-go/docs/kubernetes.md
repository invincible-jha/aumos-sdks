# Kubernetes Admission Webhook

This guide shows how to deploy the governance SDK as a Kubernetes validating
admission webhook. The webhook intercepts Pod (and other resource) creation
requests and enforces governance policy before the API server admits them.

## Architecture

```
kubectl apply → kube-apiserver → ValidatingWebhook → governance engine
                                                        ↓
                                               trust check
                                               budget check (optional)
                                               consent check (optional)
                                               audit log
                                                        ↓
                                               admit / deny → kube-apiserver
```

## Quick example

See `examples/k8s-webhook/main.go` for a complete working server.

## Deploying

### 1. Build the image

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY . .
RUN go build -o webhook ./examples/k8s-webhook/main.go

FROM alpine:3.19
COPY --from=builder /app/webhook /webhook
EXPOSE 8443
ENTRYPOINT ["/webhook"]
```

```bash
docker build -t your-registry/governance-webhook:latest .
docker push your-registry/governance-webhook:latest
```

### 2. Create the Deployment and Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: governance-webhook
  namespace: governance-system
spec:
  replicas: 2
  selector:
    matchLabels:
      app: governance-webhook
  template:
    metadata:
      labels:
        app: governance-webhook
    spec:
      containers:
        - name: webhook
          image: your-registry/governance-webhook:latest
          ports:
            - containerPort: 8443
---
apiVersion: v1
kind: Service
metadata:
  name: governance-webhook
  namespace: governance-system
spec:
  selector:
    app: governance-webhook
  ports:
    - port: 443
      targetPort: 8443
```

### 3. Register the ValidatingWebhookConfiguration

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: governance-webhook
webhooks:
  - name: governance.aumos.ai
    admissionReviewVersions: ["v1"]
    clientConfig:
      service:
        name: governance-webhook
        namespace: governance-system
        path: /validate
    rules:
      - operations: ["CREATE", "UPDATE"]
        apiGroups: [""]
        apiVersions: ["v1"]
        resources: ["pods"]
    failurePolicy: Fail
    sideEffects: None
```

## TLS

Kubernetes requires HTTPS for webhook endpoints. Use cert-manager:

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: governance-webhook-cert
  namespace: governance-system
spec:
  secretName: governance-webhook-tls
  dnsNames:
    - governance-webhook.governance-system.svc
    - governance-webhook.governance-system.svc.cluster.local
  issuerRef:
    name: cluster-issuer
    kind: ClusterIssuer
```

Then mount the secret in the Deployment and pass the cert/key paths to
`http.ListenAndServeTLS`.

## Governance policy configuration

Trust assignments and consent grants should be seeded at startup from your
policy store. For example:

```go
// Load policy from a ConfigMap or external store at startup.
for _, sa := range trustedServiceAccounts {
    _, _ = engine.Trust.SetLevel(ctx, sa.Name, sa.Level, "k8s",
        governance.WithAssignedBy("policy"),
    )
}
```

Because MemoryStorage is in-memory, trust assignments are lost on restart.
For production, implement `storage.Storage` backed by etcd or Redis so
assignments survive pod restarts.

## Observability

The audit log records every admission decision. Expose it via a `/audit`
HTTP endpoint or stream records to your SIEM:

```go
http.HandleFunc("/audit", func(w http.ResponseWriter, r *http.Request) {
    records, _ := engine.Audit.Query(r.Context(), governance.WithQueryLimit(100))
    json.NewEncoder(w).Encode(records)
})
```
