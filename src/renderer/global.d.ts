import type { GcApi } from '@shared/types'

declare global {
  interface Window {
    gc: GcApi
  }
}

export {}
