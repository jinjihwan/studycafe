// Exact-origin policy with a narrowly scoped GitHub Codespaces proxy exception.
// No wildcard domains, arbitrary forwarded-host trust or global localhost bypass.
function loopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function originDecision(req, publicOrigins) {
  const raw = req.headers.origin;
  // Non-browser clients may omit Origin, as in v5. Auth still applies to WS.
  if (!raw) return {ok:true, reason:'missing origin'};
  let url;
  try {
    url = new URL(raw);
    if (url.origin !== raw || !['http:', 'https:'].includes(url.protocol)) {
      return {ok:false, reason:'invalid Origin format'};
    }
  } catch {
    return {ok:false, reason:'invalid Origin URL'};
  }

  if (!publicOrigins.size) {
    return url.host === req.headers.host
      ? {ok:true, reason:'local same-host'}
      : {ok:false, reason:'Origin host differs from request Host'};
  }
  if (publicOrigins.has(url.origin)) return {ok:true, reason:'public allowlist'};

  // Codespaces forwarded public HTTPS origin is rewritten to https://localhost:PORT
  // on its *local* proxy-to-app hop. Accept only this exact configuration:
  //   * an explicitly configured public origin,
  //   * an exact forwarded public host matching an allowed HTTPS origin,
  //   * local loopback peer, local Host and matching local Origin port.
  // All checks below must hold. Never allow arbitrary localhost Origins.
  const host = req.headers.host;
  const forwardedHost = req.headers['x-forwarded-host'];
  const forwardedProto = req.headers['x-forwarded-proto'];
  const match = typeof host === 'string' && /^localhost:([1-9]\d{0,4})$/.exec(host);
  if (match && Number(match[1]) <= 65535 &&
      loopback(req.socket?.remoteAddress) &&
      url.protocol === 'https:' && url.hostname === 'localhost' &&
      url.port === match[1] &&
      typeof forwardedHost === 'string' &&
      /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(forwardedHost) &&
      (forwardedProto === undefined || forwardedProto === 'https') &&
      publicOrigins.has(`https://${forwardedHost}`) &&
      forwardedHost.endsWith('.app.github.dev')) {
    return {ok:true, reason:'trusted Codespaces local proxy'};
  }
  return {ok:false, reason:'not in configured allowlist or trusted Codespaces local proxy'};
}
