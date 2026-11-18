import { formatDateEs, formatMinutes, isValidIsoDate } from '../date';
import { formatMinor, maskMoneyInput, minorToMaskedInput, parseMoneyToMinor } from '../money';

describe('money', () => {
  it('formats minor units as RD$ with grouping and two decimals', () => {
    expect(formatMinor(100_000_000)).toBe('RD$1,000,000.00');
    expect(formatMinor(1_000_000)).toBe('RD$10,000.00');
    expect(formatMinor(5)).toBe('RD$0.05');
  });

  it('masks typed digits from the right, like a cents field', () => {
    expect(maskMoneyInput('1')).toBe('RD$0.01');
    expect(maskMoneyInput('1000000')).toBe('RD$10,000.00');
    expect(maskMoneyInput('')).toBe('');
    expect(maskMoneyInput('000')).toBe('RD$0.00');
  });

  it('parses the masked text back to minor units', () => {
    expect(parseMoneyToMinor('RD$10,000.00')).toBe(1_000_000);
    expect(parseMoneyToMinor('')).toBeNull();
    expect(minorToMaskedInput(1_000_000)).toBe('RD$10,000.00');
    expect(minorToMaskedInput(null)).toBe('');
  });
});

describe('dates', () => {
  it('formats ISO dates as day, short Spanish month and year', () => {
    expect(formatDateEs('2026-11-16')).toBe('16 nov 2026');
    expect(formatDateEs('2026-01-03T10:00:00Z')).toBe('3 ene 2026');
  });

  it('accepts only real calendar dates in AAAA-MM-DD', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('16/11/2026')).toBe(false);
  });

  it('formats minutes as hours and minutes', () => {
    expect(formatMinutes(340)).toBe('5h 40m');
  });
});
