export const origins = {
  aws: 'https://novapay-34-248-87-22.sslip.io',
  azure: 'https://novapay-azure-ankit-20260915-csg2a3bbarhqf2e6.westus3-01.azurewebsites.net'
};
export async function healthy(name, send, diagnostics = {}) {
  try {
    const r = await send(origins[name] + '/health', {redirect:'manual', cache:'no-store', signal:AbortSignal.timeout(8000)});
    diagnostics[name] = {http_status:r.status}; if (!r.ok) { await r.body?.cancel(); return false; }
    const data = await r.json();
    return data.status === 'healthy' && data.db === 'connected' && data.server === name;
  } catch (error) { diagnostics[name] = {error: String(error.message)}; return false; }
}
export async function handle(request, send = fetch) {
  const url = new URL(request.url);
  const browserOrigin = request.headers.get('Origin');
  const referrer = request.headers.get('Referer');
  let browserReferrer;
  try { browserReferrer = referrer ? new URL(referrer) : null; }
  catch { return new Response('Invalid referrer.', {status:403}); }
  if (!['GET','HEAD','OPTIONS'].includes(request.method) &&
      ((browserOrigin && browserOrigin !== url.origin) ||
       (browserReferrer && browserReferrer.origin !== url.origin))) {
    return new Response('Cross-origin request rejected.', {status:403});
  }
  if (url.pathname === '/proxy/update-routing') return new Response('Independent gateway uses automatic health-based routing.', {status:409});
  const diagnostics = {}; const active = await healthy('aws', send, diagnostics) ? 'aws' : await healthy('azure', send, diagnostics) ? 'azure' : null;
  if (['/proxy/status','/proxy/health'].includes(url.pathname)) return Response.json({proxy:'cloudflare', diagnostics, active_cloud:active, upstream_connected:!!active, policy:'Prefer healthy AWS, otherwise healthy Azure; checked per request'}, {status:active?200:503, headers:{'Cache-Control':'no-store'}});
  if (!active) return new Response('Both banking nodes are unavailable.', {status:503});
  const target = new URL(origins[active]);
  target.pathname = url.pathname; target.search = url.search;
  const headers = new Headers(request.headers);
  for (const key of ['host','connection','transfer-encoding','x-forwarded-for','x-forwarded-prefix','x-real-ip']) headers.delete(key);
  // Validate the public origin above before translating it for upstream CSRF checks.
  headers.set('X-Forwarded-Host',target.host);
  if (browserOrigin === url.origin) headers.set('Origin',target.origin);
  if (browserReferrer && browserReferrer.origin === url.origin) {
    browserReferrer.host = target.host;
    browserReferrer.protocol = target.protocol;
    headers.set('Referer',browserReferrer.toString());
  }
  headers.set('X-Forwarded-Proto','https');
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) headers.set('X-Forwarded-For',ip);
  try {
    const options = {method:request.method,headers,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(30000)};
    if (!['GET','HEAD'].includes(request.method)) { options.body=request.body; options.duplex='half'; }
    const response = await send(target.toString(),options);
    const outgoing = new Headers(response.headers);
    const location = outgoing.get('Location');
    if (location) {
      const redirect = new URL(location, origins[active]);
      if (Object.values(origins).includes(redirect.origin)) {
        redirect.host=url.host; redirect.protocol=url.protocol;
        outgoing.set('Location',redirect.toString());
      }
    }
    outgoing.set('Cache-Control','no-store');
    outgoing.set('X-NovaPay-Cloud',active);
    return new Response(response.body,{status:response.status,headers:outgoing});
  } catch {
    // Never replay a possibly committed payment on the other cloud.
    return new Response('Connection interrupted. Check transaction history before submitting again.',{status:502,headers:{'Cache-Control':'no-store'}});
  }
}
export default {fetch(request) { return handle(request); }};


