import { HugeiconsIcon } from '@hugeicons/react'
import ArrowRight01 from '@hugeicons/core-free-icons/ArrowRight01Icon'
import Search01 from '@hugeicons/core-free-icons/Search01Icon'
import Notification02 from '@hugeicons/core-free-icons/Notification02Icon'
import Settings01 from '@hugeicons/core-free-icons/Settings01Icon'
import Tag01 from '@hugeicons/core-free-icons/Tag01Icon'
import BookOpen02 from '@hugeicons/core-free-icons/BookOpen02Icon'
import Calendar03 from '@hugeicons/core-free-icons/Calendar03Icon'
import Cancel01 from '@hugeicons/core-free-icons/Cancel01Icon'
import File02 from '@hugeicons/core-free-icons/File02Icon'
import FileUpload from '@hugeicons/core-free-icons/FileUploadIcon'
import GridView from '@hugeicons/core-free-icons/GridViewIcon'
import Image01 from '@hugeicons/core-free-icons/Image01Icon'
import Layers01 from '@hugeicons/core-free-icons/Layers01Icon'
import Library from '@hugeicons/core-free-icons/LibraryIcon'
import Link01 from '@hugeicons/core-free-icons/Link01Icon'
import Logout01 from '@hugeicons/core-free-icons/Logout01Icon'
import MailSend01 from '@hugeicons/core-free-icons/MailSend01Icon'
import Moon02 from '@hugeicons/core-free-icons/Moon02Icon'
import MusicNote01 from '@hugeicons/core-free-icons/MusicNote01Icon'
import PlusSign from '@hugeicons/core-free-icons/PlusSignIcon'
import ComputerVideo from '@hugeicons/core-free-icons/ComputerVideoIcon'
import Star from '@hugeicons/core-free-icons/StarIcon'
import Sun03 from '@hugeicons/core-free-icons/Sun03Icon'
import UserGroup from '@hugeicons/core-free-icons/UserGroupIcon'

import PencilEdit from '@hugeicons/core-free-icons/PencilEdit01Icon'
import MoreVertical from '@hugeicons/core-free-icons/MoreVerticalIcon'
import ArrowLeft from '@hugeicons/core-free-icons/ArrowLeft01Icon'
import FirstPage from '@hugeicons/core-free-icons/ArrowLeftDoubleIcon'
import LastPage from '@hugeicons/core-free-icons/ArrowRightDoubleIcon'

const icons: Record<string, typeof BookOpen02> = {
  edit: PencilEdit,
  more: MoreVertical,
  prev: ArrowLeft,
  first: FirstPage,
  last: LastPage,
  books: BookOpen02,
  search: Search01,
  bell: Notification02,
  settings: Settings01,
  upload: FileUpload,
  publications: BookOpen02,
  'publication-sections': Layers01,
  passages: File02,
  teachings: ComputerVideo,
  hymns: MusicNote01,
  synaxarium: Library,
  'daily-readings': Calendar03,
  files: FileUpload,
  media: Image01,
  users: UserGroup,
  'auth-accounts': Link01,
  'book-ratings': Star,
  'book-deliveries': MailSend01,
  'social-deliveries': MailSend01,
  categories: Tag01,
  dashboard: GridView,
  next: ArrowRight01,
  add: PlusSign,
  close: Cancel01,
  light: Sun03,
  dark: Moon02,
  logout: Logout01,
}
export function Icon({ name, size = 19 }: { name: string; size?: number }) {
  return (
    <HugeiconsIcon icon={icons[name] ?? File02} size={size} strokeWidth={1.6} aria-hidden="true" />
  )
}
