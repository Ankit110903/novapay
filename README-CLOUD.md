# Live cloud deployment

This file describes the new deployment. Older App Runner, Azure B1/container, Render and local simulation instructions are not the deployed architecture.

## Addresses

- AWS application: https://novapay-34-248-87-22.sslip.io
- AWS-hosted gateway: https://novapay-gateway-34-248-87-22.sslip.io
- Azure application: https://novapay-azure-ankit-20260915-csg2a3bbarhqf2e6.westus3-01.azurewebsites.net

Check each `/health` endpoint: HTTP 200 must include `status=healthy`, `db=connected` and the correct server identity. Azure is currently blocked by a free-plan quota after startup failures; its source must be rebuilt with dependencies after the quota resets. Do not report the system as fully operational yet.

## Architecture and limits

Both application nodes connect to the existing shared Supabase database. There is no independent database replica; a database outage affects both nodes. The AWS gateway forwards requests to the selected node. The monitor probes both real health endpoints every 30 seconds, records measured telemetry, and requires three failed probes or the configured latency condition before attempting a switch. It verifies the standby before switching. Timeout and polling delays add to detection time. Recorded switch duration is not total recovery time.

The gateway and monitor run on the AWS instance. They can demonstrate application-process failure recovery, but cannot provide whole-AWS-outage recovery. An independent gateway and monitor are required for that. Use one gateway worker because routing state is in process memory; the state file restores the last confirmed route across restarts.

Free Azure F1 is a limited demonstration host: it has no always-on guarantee and quotas can stop the application. AWS consumes the account's Free Plan credits. Neither arrangement promises indefinite free or production-grade availability. The AWS public IP can change after stop/start; update URLs and Caddy configuration then.

## Services on AWS

- `novapay-bank`: banking app on loopback port 5000.
- `novapay-proxy`: one-worker gateway on loopback port 8080.
- `novapay-monitor`: real cloud health checks and database telemetry.
- `caddy`: public HTTPS, certificates and forwarding.

Service definitions for the gateway and monitor are in `deploy/`. Runtime settings live in `/opt/novapay/.env`, restricted to the service account/root. Routing state is `/var/lib/novapay/route.json`. Never publish runtime settings or the private deployment archive.

## Azure settings

Use Linux Python 3.11. Enable both `SCM_DO_BUILD_DURING_DEPLOYMENT=true` and `ENABLE_ORYX_BUILD=true`. Startup: `gunicorn --bind=0.0.0.0:8000 --workers=2 --threads=2 --timeout=120 run:app`.

AWS and Azure must use the same SECRET_KEY, ENCRYPTION_KEY, DATABASE_URL, SUPABASE_URL and SUPABASE_KEY. Set PRIMARY_CLOUD separately to aws or azure. Set FLASK_ENV=production and SESSION_COOKIE_SECURE=true. Keep demo deposits and scheduled transfer processing disabled until those features are deliberately configured.

## Remaining verification

After Azure is healthy, use the gateway for a login test; stop only the AWS banking service, observe detection and a confirmed route to Azure, then restore the AWS service. Check that the same session works through the gateway. Record timing and actual results. This outage test has not yet been completed.

The banking ledger is academic and has no real payment-provider integration. Hosting on real clouds does not enable real-money payments. Rate limits currently use per-process memory and require shared storage before production use.

## Tests

Run `python -m unittest test_deployment.py` from the source folder. Ten regression checks cover healthy/degraded probes, routing authorization, persisted state, failed writes, failed switches, cookies, repeated query parameters and missing telemetry. They use mocks and do not modify live financial records.

## Independent Cloudflare gateway — deployed

Public address: https://novapay-independent-gateway.novapay-ankit110903.workers.dev

This Cloudflare Worker is the independent public entry point. It probes AWS directly before each request and selects Azure if AWS fails its health check. It requires no AWS-hosted monitor or database credentials. It prefers AWS again once healthy; this differs from the older AWS gateway's persistent/manual routing policy. Manual routing changes return HTTP 409 on the Cloudflare gateway.

Verified: public gateway health HTTP 200 with AWS selected; login HTTP 200 and NovaPay page content. Eight local gateway regression checks pass. Azure is still unavailable, so a live AWS-to-Azure outage test remains pending. Requests already forwarded are never automatically replayed to another cloud, to avoid duplicate payments. Health probes add request latency, and this remains subject to Cloudflare's free-plan limits. The shared database is still a common dependency.

The older AWS gateway remains available as a secondary address. Its monitor and failover records describe that gateway, not the per-request Cloudflare routing decisions. Query the Cloudflare /proxy/health endpoint for its current selection.

