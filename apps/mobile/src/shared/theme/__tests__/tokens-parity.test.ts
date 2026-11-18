import { readFileSync } from 'node:fs';
import path from 'node:path';
import { portalBaseColors } from '../tokens';

// Fails when the portal changes a base brand color and the mobile tokens are not updated.
const globalsPath = path.resolve(__dirname, '../../../../../../apps/portal/app/globals.css');

function readPortalVariables(): Map<string, string> {
  // The light theme is the first occurrence of each variable; the dark block comes later.
  const css = readFileSync(globalsPath, 'utf8');
  const map = new Map<string, string>();
  for (const match of css.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const name = match[1] ?? '';
    if (!map.has(name)) map.set(name, (match[2] ?? '').toLowerCase());
  }
  return map;
}

describe('brand tokens parity with the portal', () => {
  const portal = readPortalVariables();

  it.each(Object.entries(portalBaseColors))('%s matches globals.css', (name, value) => {
    expect(portal.get(name)).toBe(value.toLowerCase());
  });
});
