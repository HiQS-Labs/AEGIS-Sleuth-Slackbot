
class DateUtils {
  /**
   * Returns a "localized UTC" representation of the given date in the given time zone.
   * 
   * The "localized UTC" representation is essentially "the time and date in the specified time zone" and is a required 
   * hack because JavaScript's Date object does not have a built-in way to store time zone information. You can manipulate
   * the resulting date object using the getUTC*() and setUTC*() methods to perform operations that are relative to the
   * specified time zone (e.g. doing setUTCDate(getUTCDate() + 1) to get the next day in the specified time zone will work
   * correctly without off-by-one errors that would occur if we used "standard UTC" dates which have not been localized to
   * a specific time zone).
   * 
   * This took a significant amount of time to figure out and you can see all the gory details in this ChatGPT discussion
   * on the matter: https://chatgpt.com/share/672c0560-ea0c-8008-af40-b638e9f68b91.
   * 
   * @param {string} ArgTimeZone Time zone to convert the date to.
   * @param {Date} ArgForUtcDate Date to convert to the specified time zone.
   * @returns {Date} Localized UTC date.
   */
  static GetLocalizedUtcDate(ArgTimeZone, ArgForUtcDate) {
    // create a date formatter that will format the date in the specified time zone. We use the en-GB locale to get the
    // resulting string in the "dd/MM/yyyy" format so we can parse the string components more intuitively (using the en-US
    // locale would also work but we would have to switch the month and day components when parsing the string).
    const TimeZoneFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: ArgTimeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', // use 24-hour time format to avoid AM/PM concerns.
    });

    // convert the given UTC date to the specified time zone and format it as a string using the en-GB conventions
    // (i.e. "dd/MM/yyyy, HH:mm:ss"). We will parse this string to get the localized date components later below.
    const LocalizedTargetDateString = TimeZoneFormatter.format(ArgForUtcDate);

    // split the localized date string into its components (e.g. "dd/MM/yyyy, HH:mm:ss" -> ["dd", "MM", "yyyy", "HH", "mm", "ss"]).
    // The regex specifies the characters that separate the components (e.g. "/", ":", and ","). We then trim each component
    // and parse it as an integer to get the date components.
    const DateComponents = LocalizedTargetDateString.split(/[/,:]/).map(component => parseInt(component.trim()));

    // return a new date object that represents the localized UTC date in the specified time zone. NOTE: months are
    // zero-based in JavaScript so we subtract 1 from the month component to get the correct month value.
    const [day, month, year, hour, minute, second] = DateComponents;
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }

  /**
   * Returns the time zone offset in minutes for the given time zone, evaluated at the given
   * instant (defaults to now). Passing a reference instant matters across DST transitions, where
   * the offset differs between parts of the year.
   * @param {string} ArgTimeZone Time zone to get the offset for.
   * @param {Date} [ArgForUtcDate] Instant at which to evaluate the offset (defaults to now).
   * @returns {number} Time zone offset in minutes.
   */
  static GetTimeZoneOffsetInMinutes(ArgTimeZone, ArgForUtcDate = new Date()) {
    // get the reference date in UTC and then get the same date in the specified time zone. Both dates are still in UTC but
    // the second date has been localized to the specified time zone by shifting back or forward by the time zone offset
    // so when we compare the millisecond timestamps of the two dates, we get the time zone offset in milliseconds.
    const GlobalizedUtcCurrentDate = ArgForUtcDate;
    const LocalizedUtcCurrentDate = this.GetLocalizedUtcDate(ArgTimeZone, GlobalizedUtcCurrentDate);
    const OffsetInMilliseconds = LocalizedUtcCurrentDate.getTime() - GlobalizedUtcCurrentDate.getTime();

    // convert the offset from milliseconds to minutes and return the result. We do this in multiple steps to make it
    // easier to understand the conversion process.
    const OffsetInSeconds = OffsetInMilliseconds / 1000;
    const OffsetInMinutes = OffsetInSeconds / 60;
    const RoundedOffset = Math.round(OffsetInMinutes); // round to the nearest minute to get expected results.

    // Log offset calculation for debugging
    console.log(`[OFFSET CALC] Timezone: ${ArgTimeZone}, GlobalizedUTC: ${GlobalizedUtcCurrentDate.toUTCString()}, LocalizedUTC: ${LocalizedUtcCurrentDate.toUTCString()}, Offset: ${RoundedOffset} minutes`);

    return RoundedOffset;
  }

  /**
   * Returns the current date in the given time zone.
   * @param {string} ArgTimeZone Time zone to get the current date for.
   * @returns {Date}
   */
  static GetCurrentDateInTimeZone(ArgTimeZone) {
    return this.GetLocalizedUtcDate(ArgTimeZone, new Date());
  }

  /**
   * Returns the calendar-week window (Sunday 00:00 through the following Sunday 00:00) that
   * contains the reference instant, expressed in the given time zone.
   *
   * StartMs/EndMs are real-UTC epoch milliseconds suitable for comparing against actual event
   * timestamps (the localized-UTC week boundaries are shifted back by the time-zone offset).
   * StartLocal/EndLocal are the localized-UTC boundary dates, useful for building display labels
   * via their getUTC*() accessors.
   *
   * @param {string} ArgTimeZone Time zone whose calendar week defines the window.
   * @param {Date} [ArgReferenceUtcDate] Reference instant (defaults to now).
   * @returns {{ StartMs: number, EndMs: number, StartLocal: Date, EndLocal: Date }}
   */
  static GetCalendarWeekRange(ArgTimeZone, ArgReferenceUtcDate = new Date()) {
    const Localized = this.GetLocalizedUtcDate(ArgTimeZone, ArgReferenceUtcDate);

    // Sunday 00:00 of the current week, in localized-UTC space.
    const StartLocal = new Date(Localized);
    StartLocal.setUTCHours(0, 0, 0, 0);
    StartLocal.setUTCDate(StartLocal.getUTCDate() - StartLocal.getUTCDay());

    // The following Sunday 00:00 (exclusive end of the Sun–Sat week).
    const EndLocal = new Date(StartLocal);
    EndLocal.setUTCDate(EndLocal.getUTCDate() + 7);

    // Shift each localized-UTC boundary back to real UTC using the offset that applies at that
    // specific boundary (not a single "now" offset), so the window stays correct for past/future
    // weeks and across a DST transition that lands mid-week.
    return {
      StartMs: this.#LocalizedWallClockToUtcMs(ArgTimeZone, StartLocal),
      EndMs: this.#LocalizedWallClockToUtcMs(ArgTimeZone, EndLocal),
      StartLocal,
      EndLocal,
    };
  }

  /**
   * Convert a localized-UTC wall-clock date (as produced by GetLocalizedUtcDate or the week-boundary
   * math above) back into a real-UTC epoch-millisecond instant, using the time-zone offset sampled
   * at that wall-clock time. Exact except inside the ~1h DST overlap/gap window around a transition.
   * @param {string} ArgTimeZone Time zone the wall-clock belongs to.
   * @param {Date} ArgLocalizedWallClock Localized-UTC wall-clock boundary.
   * @returns {number} Real-UTC epoch milliseconds.
   */
  static #LocalizedWallClockToUtcMs(ArgTimeZone, ArgLocalizedWallClock) {
    const OffsetMs = this.GetTimeZoneOffsetInMinutes(
      ArgTimeZone, new Date(ArgLocalizedWallClock.getTime())
    ) * 60 * 1000;
    return ArgLocalizedWallClock.getTime() - OffsetMs;
  }
}

// export the class.
module.exports = DateUtils;

