import { NextResponse } from 'next/server';
import { getUpdateStatus } from '@/lib/update';

export const dynamic = 'force-dynamic';

/** Public, read-only: versions and whether in-app updates are available. No secrets. */
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get('refresh') === '1';
  return NextResponse.json(await getUpdateStatus(force));
}
