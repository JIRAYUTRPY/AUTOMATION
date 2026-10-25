import { access, constants } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { loadConfig } from '@automation/shared';

export const dynamic = 'force-dynamic';

export async function GET() {
  const config = loadConfig();
  let dataWritable = true;
  try {
    await access(config.ARTIFACT_DIR.replace(/\/artifacts\/?$/, '') || '.', constants.W_OK);
  } catch {
    dataWritable = false;
  }
  const ok = dataWritable;
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', service: 'web', checks: { dataWritable } },
    { status: ok ? 200 : 503 },
  );
}
