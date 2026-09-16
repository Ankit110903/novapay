# Deployment status

AWS and the independent Cloudflare gateway passed their latest health checks. Azure's source build succeeded, but healthy startup and live cross-cloud failover remain unverified.

Runtime credentials are excluded from this repository. Configure them privately in your hosting provider. The application is an academic banking ledger and is not connected to real payment rails.

Ten Python and eight gateway regression tests passed locally. The older AWS-hosted monitor does not record Cloudflare's per-request routing decisions.
