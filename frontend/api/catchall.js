export const config = {
  maxDuration: 60,
};

function resolveApiUrl(req) {
  const raw = String(req.url || '/');
  const parsed = new URL(raw, 'http://localhost');
  const fromQuery = parsed.searchParams.get('__path');
  if (fromQuery) {
    parsed.searchParams.delete('__path');
    const qs = parsed.searchParams.toString();
    return `/api/${String(fromQuery).replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
  }

  const headerPath = String(
    req.headers['x-invoke-path'] ||
      req.headers['x-matched-path'] ||
      req.headers['x-forwarded-uri'] ||
      '',
  ).split('?')[0];

  if (headerPath.startsWith('/api/')) {
    return `${headerPath}${parsed.search || ''}`;
  }

  let pathname = parsed.pathname || '/';
  if (pathname === '/api/catchall' || pathname === '/api') {
    pathname = '/api/';
  }
  if (!pathname.startsWith('/api/')) {
    const suffix = pathname.startsWith('/') ? pathname : `/${pathname}`;
    pathname = suffix.startsWith('/api') ? suffix : `/api${suffix}`;
  }
  return `${pathname}${parsed.search || ''}`;
}

export default async function handler(req, res) {
  try {
    req.url = resolveApiUrl(req);

    const [{ handleApiRequest }, { getRuntimeEnv }] = await Promise.all([
      import('../server/apiRouter.js'),
      import('../server/runtimeEnv.js'),
    ]);

    const handled = await handleApiRequest(req, res, getRuntimeEnv);
    if (!handled && !res.writableEnded && !res.headersSent) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Unknown API route.', path: req.url }));
    }
  } catch (err) {
    console.error('[api/catchall]', err);
    if (!res.writableEnded && !res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error: err.message || 'API request failed.',
          name: err.name || null,
        }),
      );
    }
  }
}
