import { enTranslations } from '@payloadcms/translations/languages/en'
import type { DefaultTranslationsObject, Language } from '@payloadcms/translations'

export const amTranslations: DefaultTranslationsObject = {
  ...enTranslations,
  general: {
    ...enTranslations.general,
    thisLanguage: 'አማርኛ (Amharic)',
    dashboard: 'ዳሽቦርድ',
    collections: 'ስብስቦች',
    globals: 'አጠቃላይ ቅንብሮች',
    createNew: 'አዲስ ፍጠር',
    create: 'ፍጠር',
    creating: 'በመፍጠር ላይ...',
    save: 'አስቀምጥ',
    saving: 'በማስቀመጥ ላይ...',
    updatedSuccessfully: 'በተሳካ ሁኔታ ተቀምጧል',
    cancel: 'ይቅር',
    delete: 'ሰርዝ',
    deleting: 'በመሰረዝ ላይ...',
    deletedSuccessfully: 'በተሳካ ሁኔታ ተሰርዟል',
    edit: 'አርትዕ',
    editing: 'በማረም ላይ...',
    loading: 'በመጫን ላይ...',
    backToDashboard: 'ወደ ዳሽቦርድ ተመለስ',
    noResults: 'ምንም ውጤት አልተገኘም',
    filter: 'አጣራ',
    filterWhere: 'የት እንደሚገኝ አጣራ',
    searchBy: 'ፈልግ በ',
    confirm: 'አረጋግጥ',
    confirmDeletion: 'መሰረዙን አረጋግጥ',
    close: 'ዝጋ',
    open: 'ክፈት',
    submit: 'አስገባ',
    updatedAt: 'የተሻሻለበት',
    createdAt: 'የተፈጠረበት',
    adminTheme: 'የአስተዳዳሪ ገጽታ',
    all: 'ሁሉም',
    columns: 'አምዶች',
    selectValue: 'እሴት ይምረጡ',
    leaveWithoutSaving: 'ሳያስቀምጡ ይውጡ',
    unsavedChangesDuplicate: 'ያልተቀመጡ ለውጦች አሉ። እርግጠኛ ነዎት መውጣት ይፈልጋሉ?',
  },
  authentication: {
    ...enTranslations.authentication,
    login: 'ግባ',
    logout: 'ውጣ',
    logOut: 'ውጣ',
    loggingOut: 'በመውጣት ላይ...',
    logoutSuccessful: 'በተሳካ ሁኔታ ወጥተዋል',
    emailOrUsername: 'ኢሜይል ወይም የተጠቃሚ ስም',
    passwordResetSuccessfully: 'የይለፍ ቃል በተሳካ ሁኔታ ተቀይሯል',
    changePassword: 'የይለፍ ቃል ቀይር',
    forgotPassword: 'የይለፍ ቃል ረሱ?',
    resetPassword: 'የይለፍ ቃል ዳግም አስጀምር',
    resetYourPassword: 'የይለፍ ቃልዎን ዳግም ያስጀምሩ',
    backToLogin: 'ወደ መግቢያ ተመለስ',
    stayLoggedIn: 'ገብቼ ልቆይ',
    account: 'መለያ',
    accountOfCurrentUser: 'የአሁኑ ተጠቃሚ መለያ',
    createFirstUser: 'የመጀመሪያ ተጠቃሚ ፍጠር',
  },
  dashboard: {
    ...enTranslations.dashboard,
    noItems: 'ምንም ንጥሎች የሉም',
  },
  upload: {
    ...enTranslations.upload,
    dragAndDropHere: 'ፋይሎችን እዚህ ይጎትቱ ወይም ለመምረጥ ይጫኑ',
    fileName: 'የፋይል ስም',
    fileSize: 'የፋይል መጠን',
    selectFile: 'ፋይል ምረጥ',
  },
  fields: {
    ...enTranslations.fields,
    addLabel: 'አዲስ {{label}} አክል',
    addNew: 'አዲስ አክል',
    chooseFromExisting: 'ካሉት ምረጥ',
    uploadNewLabel: 'አዲስ ስቀል',
  },
  localization: {
    ...enTranslations.localization,
    selectLocaleToCopy: 'ለመገልበጥ ቋንቋ ይምረጡ',
    selectedLocales: 'የተመረጡ ቋንቋዎች',
  },
  lexical: {
    checklist: {
      label: 'Checklist',
    },
    heading: {
      label: 'ርዕስ {{headingLevel}}',
    },
    paragraph: {
      label: 'አንቀጽ',
      label2: 'መደበኛ ጽሑፍ',
    },
    blockquote: {
      label: 'ጥቅስ (Quote)',
    },
    orderedList: {
      label: 'ቁጥር ያለው ዝርዝር (Ordered List)',
    },
    unorderedList: {
      label: 'ነጥብ ያለው ዝርዝር (Unordered List)',
    },
    upload: {
      label: 'ፋይል ስቀል (Upload)',
    },
    relationship: {
      label: 'ዝምድና (Relationship)',
    },
    link: {
      label: 'አገናኝ (Link)',
      loadingWithEllipsis: 'በመጫን ላይ...',
    },
    horizontalRule: {
      label: 'አግድም መስመር (Divider)',
    },
    blocks: {
      label: 'ብሎኮች (Blocks)',
      inlineBlocks: {
        label: 'የመስመር ውስጥ ብሎኮች',
      },
    },
    align: {
      alignLeftLabel: 'ወደ ግራ አሰልፍ',
      alignCenterLabel: 'መሃል አሰልፍ',
      alignRightLabel: 'ወደ ቀኝ አሰልፍ',
      alignJustifyLabel: 'እኩል አሰልፍ',
    },
    indent: {
      decreaseLabel: 'ወደ ውጭ አውጣ',
      increaseLabel: 'ወደ ውስጥ አስገባ',
    },
    general: {
      placeholder: "መጻፍ ይጀምሩ፣ ወይም ለትዕዛዞች '/' ይጫኑ...",
      slashMenuBasicGroupLabel: 'መሰረታዊ (Basic)',
      slashMenuListGroupLabel: 'ዝርዝሮች (Lists)',
      toolbarItemsActive: '{{count}} ንቁ',
    },
  },
} as any

export const am: Language = {
  dateFNSKey: 'en-US',
  translations: amTranslations,
}
