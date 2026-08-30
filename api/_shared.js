// Shared helpers for Vercel serverless functions.
function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  // Vercel parses JSON bodies automatically, but keep a fallback for raw streams.
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try { return Promise.resolve(req.body ? JSON.parse(req.body) : {}); } catch (e) { return Promise.reject(e); }
  }
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function withErrors(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      sendJson(res, 500, { error: (e && e.message) || String(e) });
    }
  };
}

module.exports = { sendJson, readBody, withErrors };
