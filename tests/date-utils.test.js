'use strict';

const DateUtils = require('../src/date-utils');

// silence the console.log inside GetTimeZoneOffsetInMinutes during tests.
beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterAll(() => console.log.mockRestore());

// ---------------------------------------------------------------------------
// GetLocalizedUtcDate
// ---------------------------------------------------------------------------

describe('DateUtils.GetLocalizedUtcDate', () => {
  // Use a fixed UTC date so tests are timezone-independent.
  // 2024-03-15 14:30:00 UTC
  const UtcDate = new Date(Date.UTC(2024, 2, 15, 14, 30, 0));

  test('returns correct wall-clock date for America/New_York (UTC-4 in March, DST active)', () => {
    // EDT is UTC-4 in mid-March (DST has started by then).
    const Result = DateUtils.GetLocalizedUtcDate('America/New_York', UtcDate);
    expect(Result.getUTCFullYear()).toBe(2024);
    expect(Result.getUTCMonth()).toBe(2);    // March (0-indexed)
    expect(Result.getUTCDate()).toBe(15);
    expect(Result.getUTCHours()).toBe(10);   // 14:30 UTC - 4h = 10:30 EDT
    expect(Result.getUTCMinutes()).toBe(30);
  });

  test('returns correct wall-clock date for America/Los_Angeles (UTC-7 in March, DST active)', () => {
    // PDT is UTC-7 in mid-March.
    const Result = DateUtils.GetLocalizedUtcDate('America/Los_Angeles', UtcDate);
    expect(Result.getUTCHours()).toBe(7);    // 14:30 UTC - 7h = 07:30 PDT
    expect(Result.getUTCMinutes()).toBe(30);
  });

  test('returns correct wall-clock date for UTC', () => {
    const Result = DateUtils.GetLocalizedUtcDate('UTC', UtcDate);
    expect(Result.getUTCHours()).toBe(14);
    expect(Result.getUTCMinutes()).toBe(30);
  });

  test('handles midnight UTC crossing a date boundary', () => {
    // 2024-03-15 01:00 UTC → 2024-03-14 21:00 EDT (UTC-4)
    const MidnightEdge = new Date(Date.UTC(2024, 2, 15, 1, 0, 0));
    const Result = DateUtils.GetLocalizedUtcDate('America/New_York', MidnightEdge);
    expect(Result.getUTCDate()).toBe(14);    // previous day
    expect(Result.getUTCHours()).toBe(21);
  });

  test('handles a half-hour offset timezone (Asia/Kolkata, UTC+5:30)', () => {
    // 2024-03-15 14:30:00 UTC → 2024-03-15 20:00:00 IST (UTC+5:30)
    const Result = DateUtils.GetLocalizedUtcDate('Asia/Kolkata', UtcDate);
    expect(Result.getUTCHours()).toBe(20);
    expect(Result.getUTCMinutes()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GetTimeZoneOffsetInMinutes
// ---------------------------------------------------------------------------

describe('DateUtils.GetTimeZoneOffsetInMinutes', () => {
  test('UTC offset is 0', () => {
    // use Math.abs to treat -0 and +0 as equal (JavaScript float edge case).
    expect(Math.abs(DateUtils.GetTimeZoneOffsetInMinutes('UTC'))).toBe(0);
  });

  test('Asia/Kolkata offset is +330 minutes (UTC+5:30)', () => {
    expect(DateUtils.GetTimeZoneOffsetInMinutes('Asia/Kolkata')).toBe(330);
  });

  test('America/New_York offset is either -240 (EDT) or -300 (EST) depending on current date', () => {
    const Offset = DateUtils.GetTimeZoneOffsetInMinutes('America/New_York');
    // EDT (summer) = UTC-4 = -240 min; EST (winter) = UTC-5 = -300 min.
    expect([-240, -300]).toContain(Offset);
  });

  test('Pacific/Auckland offset is positive (UTC+12 or UTC+13)', () => {
    const Offset = DateUtils.GetTimeZoneOffsetInMinutes('Pacific/Auckland');
    expect(Offset).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// GetCurrentDateInTimeZone
// ---------------------------------------------------------------------------

describe('DateUtils.GetCurrentDateInTimeZone', () => {
  test('returns a Date object', () => {
    const Result = DateUtils.GetCurrentDateInTimeZone('UTC');
    expect(Result).toBeInstanceOf(Date);
    expect(isNaN(Result.getTime())).toBe(false);
  });

  test('UTC result matches current UTC time within 2 seconds', () => {
    const Before = Date.now();
    const Result = DateUtils.GetCurrentDateInTimeZone('UTC');
    const After = Date.now();
    expect(Result.getTime()).toBeGreaterThanOrEqual(Before - 1000);
    expect(Result.getTime()).toBeLessThanOrEqual(After + 1000);
  });
});

// ---------------------------------------------------------------------------
// GetCalendarWeekRange
// ---------------------------------------------------------------------------

describe('DateUtils.GetCalendarWeekRange', () => {
  test('UTC: Wednesday resolves to the Sun–Sat week that contains it', () => {
    // 2026-06-10 is a Wednesday.
    const Reference = new Date(Date.UTC(2026, 5, 10, 15, 0, 0));
    const { StartMs, EndMs, StartLocal, EndLocal } = DateUtils.GetCalendarWeekRange('UTC', Reference);

    // Week starts Sunday 2026-06-07 00:00 and ends (exclusive) Sunday 2026-06-14 00:00.
    expect(StartLocal.getUTCFullYear()).toBe(2026);
    expect(StartLocal.getUTCMonth()).toBe(5);
    expect(StartLocal.getUTCDate()).toBe(7);
    expect(StartLocal.getUTCDay()).toBe(0); // Sunday
    expect(StartLocal.getUTCHours()).toBe(0);

    expect(EndLocal.getUTCDate()).toBe(14);
    expect(EndLocal.getUTCDay()).toBe(0); // following Sunday

    // In UTC there is no offset, so the localized boundaries equal the real-UTC boundaries.
    expect(StartMs).toBe(Date.UTC(2026, 5, 7, 0, 0, 0));
    expect(EndMs).toBe(Date.UTC(2026, 5, 14, 0, 0, 0));
    expect(EndMs - StartMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('the reference instant always falls within [StartMs, EndMs)', () => {
    const Reference = new Date(Date.UTC(2026, 5, 10, 15, 0, 0));
    const { StartMs, EndMs } = DateUtils.GetCalendarWeekRange('America/Los_Angeles', Reference);
    expect(Reference.getTime()).toBeGreaterThanOrEqual(StartMs);
    expect(Reference.getTime()).toBeLessThan(EndMs);
    expect(EndMs - StartMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('a Sunday reference starts its own week (not the prior one)', () => {
    // 2026-06-07 is a Sunday; 08:00 UTC is still Sunday in UTC.
    const Reference = new Date(Date.UTC(2026, 5, 7, 8, 0, 0));
    const { StartLocal } = DateUtils.GetCalendarWeekRange('UTC', Reference);
    expect(StartLocal.getUTCDate()).toBe(7);
    expect(StartLocal.getUTCDay()).toBe(0);
  });

  test('boundaries use the offset at the reference week, not at "now" (winter, EST = UTC-5)', () => {
    // 2026-01-14 is a Wednesday in America/New_York winter (EST, UTC-5). Independent of when the
    // test runs, the Sun–Sat window is Jan 11 00:00 EST → Jan 18 00:00 EST.
    const Reference = new Date(Date.UTC(2026, 0, 14, 12, 0, 0));
    const { StartMs, EndMs } = DateUtils.GetCalendarWeekRange('America/New_York', Reference);
    expect(StartMs).toBe(Date.UTC(2026, 0, 11, 5, 0, 0)); // 00:00 EST = 05:00 UTC
    expect(EndMs).toBe(Date.UTC(2026, 0, 18, 5, 0, 0));
    expect(Reference.getTime()).toBeGreaterThanOrEqual(StartMs);
    expect(Reference.getTime()).toBeLessThan(EndMs);
  });

  test('boundaries use the offset at the reference week (summer, EDT = UTC-4)', () => {
    // 2026-07-15 is a Wednesday in America/New_York summer (EDT, UTC-4); week is Jul 12 → Jul 19.
    const Reference = new Date(Date.UTC(2026, 6, 15, 12, 0, 0));
    const { StartMs, EndMs } = DateUtils.GetCalendarWeekRange('America/New_York', Reference);
    expect(StartMs).toBe(Date.UTC(2026, 6, 12, 4, 0, 0)); // 00:00 EDT = 04:00 UTC
    expect(EndMs).toBe(Date.UTC(2026, 6, 19, 4, 0, 0));
  });
});

