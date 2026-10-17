export const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
/** Wrap a route handler: consistent JSON errors, no stack traces leaked. */
export const handle = (fn) => async (req, ctx) => {
  try { return await fn(req, ctx); }
  catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    if (status === 500) console.error('[api]', e);
    return json({ error: status === 500 ? 'Internal error' : e.message }, status);
  }
};
export const readJson = async (req) => { try { const b = await req.json(); return b && typeof b === 'object' ? b : {}; } catch { return {}; } };
export const bad = (m, status = 400) => Object.assign(new Error(m), { status });

export const docId = async (params) => {
  const { id } = await params;
  const n = Number(id);

  if (!Number.isInteger(n) || n < 1) {
    throw bad("Invalid document id");
  }

  return n;
};

