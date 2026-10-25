import { NextResponse } from 'next/server';
import { checkAdminToken, updaterRequest } from '@/lib/update';

export const dynamic = 'force-dynamic';

function guard(req: Request): NextResponse | null {
  const auth = checkAdminToken(req);
  if (auth === 'disabled') {
    return NextResponse.json(
      { error: 'admin_disabled', message: 'ADMIN_TOKEN is not configured on the server.' },
      { status: 403 },
    );
  }
  if (auth === 'denied') {
    return NextResponse.json({ error: 'unauthorized', message: 'Invalid admin token.' }, { status: 401 });
  }
  return null;
}

async function forward(path: '/update' | '/status', method: 'GET' | 'POST') {
  try {
    const res = await updaterRequest(path, method);
    if (!res) {
      return NextResponse.json(
        { error: 'updater_disabled', message: 'The optional updater is not enabled.' },
        { status: 409 },
      );
    }
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json(
      { error: 'updater_unreachable', message: 'The updater did not respond.' },
      { status: 502 },
    );
  }
}

/** Start an update. Takes no body: the target version is decided by the updater. */
export async function POST(req: Request) {
  return guard(req) ?? forward('/update', 'POST');
}

/** Progress of the current/last update. */
export async function GET(req: Request) {
  return guard(req) ?? forward('/status', 'GET');
}
