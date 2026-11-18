import { isoDateToLocalDate, localDateToIsoDate } from '../DateField';

describe('iso date ↔ local Date', () => {
  const zones = ['UTC', 'America/Santo_Domingo', 'Pacific/Kiritimati', 'America/Los_Angeles'] as const;

  it.each(zones)('round-trips AAAA-MM-DD in %s without day shift', (tz) => {
    const previous = process.env.TZ;
    process.env.TZ = tz;

    const iso = '2026-11-16';
    const local = isoDateToLocalDate(iso);
    expect(local).not.toBeNull();
    expect(local!.getFullYear()).toBe(2026);
    expect(local!.getMonth()).toBe(10);
    expect(local!.getDate()).toBe(16);
    expect(localDateToIsoDate(local!)).toBe(iso);

    process.env.TZ = previous;
  });

  it('keeps day/month/year from the ISO string in local getters', () => {
    const local = isoDateToLocalDate('2026-02-28');
    expect(local).not.toBeNull();
    expect(local!.getFullYear()).toBe(2026);
    expect(local!.getMonth()).toBe(1);
    expect(local!.getDate()).toBe(28);
    expect(localDateToIsoDate(local!)).toBe('2026-02-28');
  });

  it('returns null for non-ISO input', () => {
    expect(isoDateToLocalDate('16/11/2026')).toBeNull();
    expect(isoDateToLocalDate('2026-11-16T00:00:00Z')).toBeNull();
  });
});