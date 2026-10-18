import { NextResponse } from 'next/server';

// Optional HTTP Basic auth for the whole app. Enabled only when BASIC_AUTH_USER and BASIC_AUTH_PASSWORD are set.
// Strongly recommended for a public deployment: it protects your Gemini budget and the shared database.
export function middleware(req) {
  const user = process.env.BASIC_AUTH_USER, pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) return NextResponse.next();
  const h = req.headers.get('authorization') || '';
  if (h.startsWith('Basic ')) {
    try {
      const [u, ...rest] = atob(h.slice(6)).split(':');
      if (u === user && rest.join(':') === pass) return NextResponse.next();
    } catch { /* fall through */ }
  }
  return new NextResponse('Authentication required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="incheck", charset="UTF-8"' } });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'] };
