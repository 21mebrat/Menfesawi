import type {
  CollectionBeforeValidateHook,
  Field,
  NumberFieldSingleValidation,
  TextFieldSingleValidation,
} from 'payload'
import { ValidationError } from 'payload'
import type { SynaxariumEntry } from '../../payload-types'

const monthOptions = [
  ['Meskerem', 'መስከረም'],
  ['Tikimt', 'ጥቅምት'],
  ['Hidar', 'ኅዳር'],
  ['Tahsas', 'ታኅሣሥ'],
  ['Tir', 'ጥር'],
  ['Yekatit', 'የካቲት'],
  ['Megabit', 'መጋቢት'],
  ['Miyazya', 'ሚያዝያ'],
  ['Ginbot', 'ግንቦት'],
  ['Sene', 'ሰኔ'],
  ['Hamle', 'ሐምሌ'],
  ['Nehase', 'ነሐሴ'],
  ['Pagumen', 'ጳጉሜን'],
].map(([en, am], index) => ({ label: { en, am }, value: String(index + 1) }))

export const validateMonthAndDay: CollectionBeforeValidateHook<
  Pick<SynaxariumEntry, 'id' | 'ethiopianMonth' | 'ethiopianDay'>
> = ({ data, originalDoc, req }) => {
  if (!data) return
  const month =
    data.ethiopianMonth === undefined ? originalDoc?.ethiopianMonth : data.ethiopianMonth
  const day = data.ethiopianDay === undefined ? originalDoc?.ethiopianDay : data.ethiopianDay
  if (!monthOptions.some((option) => option.value === month)) {
    throw new ValidationError({
      errors: [
        {
          path: 'ethiopianMonth',
          message:
            req.i18n.language === 'am'
              ? 'ከአሥራ ሦስቱ ወራት አንዱን ይምረጡ።'
              : 'Select one of the thirteen Ethiopian months.',
        },
      ],
    })
  }
  const lastDay = month === '13' ? 6 : 30

  if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > lastDay) {
    throw new ValidationError({
      errors: [
        {
          path: 'ethiopianDay',
          message:
            req.i18n.language === 'am'
              ? `ለዚህ ወር ከ1 እስከ ${lastDay} ያለ ሙሉ ቁጥር ያስገቡ።`
              : `Enter a whole day from 1 through ${lastDay} for this month.`,
        },
      ],
    })
  }
}

const validateSlug: TextFieldSingleValidation = (value, { req }) =>
  (typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) ||
  (req.i18n.language === 'am'
    ? 'ትንንሽ የእንግሊዝኛ ፊደላትን፣ ቁጥሮችን እና ነጠላ ሰረዞችን ይጠቀሙ።'
    : 'Use lowercase English letters, numbers, and single hyphens.')

const validateOrder: NumberFieldSingleValidation = (value, { req }) =>
  (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
  (req.i18n.language === 'am'
    ? 'ዜሮ ወይም ከዜሮ በላይ የሆነ ሙሉ ቁጥር ያስገቡ።'
    : 'Enter a nonnegative whole number.')

export const calendarSlug = (): Field => ({
  name: 'slug',
  type: 'text',
  required: true,
  unique: true,
  index: true,
  maxLength: 150,
  label: { en: 'Slug', am: 'የአገናኝ መለያ' },
  admin: {
    description: {
      en: 'A stable identifier shared across languages. Use lowercase English letters, numbers, and single hyphens.',
      am: 'በሁሉም ቋንቋዎች የሚያገለግል ቋሚ መለያ። ትንንሽ የእንግሊዝኛ ፊደላትን፣ ቁጥሮችን እና ነጠላ ሰረዞችን ይጠቀሙ።',
    },
  },
  validate: validateSlug,
})

export const ethiopianMonth = (): Field => ({
  name: 'ethiopianMonth',
  type: 'select',
  required: true,
  options: monthOptions,
  label: { en: 'Ethiopian month', am: 'የኢትዮጵያ ወር' },
})

export const ethiopianDay = (): Field => ({
  name: 'ethiopianDay',
  type: 'number',
  required: true,
  min: 1,
  max: 30,
  label: { en: 'Ethiopian day', am: 'የወሩ ቀን' },
  admin: {
    step: 1,
    description: {
      en: 'Pagumen 6 occurs only in Ethiopian leap years. When resolving this date for a specific year, check that the year is a leap year.',
      am: 'ጳጉሜን ፮ የሚውለው በዘመነ ሉቃስ ብቻ ነው። ቀኑን ለተወሰነ ዓመት ሲያሰሉ ዓመቱ ዘመነ ሉቃስ መሆኑን ያረጋግጡ።',
    },
  },
})

export const calendarOrder = (): Field => ({
  name: 'order',
  type: 'number',
  required: true,
  defaultValue: 0,
  min: 0,
  label: { en: 'Order within the day', am: 'የዕለቱ ቅደም ተከተል' },
  admin: { step: 1 },
  validate: validateOrder,
})
