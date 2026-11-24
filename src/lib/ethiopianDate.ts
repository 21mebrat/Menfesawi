export interface EthiopianDate {
  year: number
  month: number
  day: number
}

// ICU gives Pagumen 5 + floor((year % 4) / 3) days for positive Ethiopian years.
// https://github.com/unicode-org/icu/blob/main/icu4j/main/core/src/main/java/com/ibm/icu/util/CECalendar.java#L235-L249
export function isEthiopianLeapYear(year: number): boolean {
  return year % 4 === 3
}

export function validateEthiopianDate({ year, month, day }: EthiopianDate): void {
  if (!Number.isSafeInteger(year) || year < 1)
    throw new RangeError('Expected a positive safe-integer Ethiopian year.')
  if (!Number.isInteger(month) || month < 1 || month > 13)
    throw new RangeError('Expected an Ethiopian month from 1 to 13.')
  const lastDay = month === 13 ? 5 + Number(isEthiopianLeapYear(year)) : 30
  if (!Number.isInteger(day) || day < 1 || day > lastDay)
    throw new RangeError(`Expected an Ethiopian day from 1 to ${lastDay} for this month and year.`)
}
