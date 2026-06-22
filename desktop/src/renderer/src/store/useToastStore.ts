import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: string
  message: string
  kind: ToastKind
  duration?: number
}

interface ToastStore {
  toasts: Toast[]
  addToast: (message: string, kind?: ToastKind, duration?: number) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (message, kind = 'info', duration = 3500) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    set((s) => ({ toasts: [...s.toasts, { id, message, kind, duration }] }))
    if (duration && duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, duration)
    }
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// Convenience helper — call from anywhere without hooks
export const toast = {
  info: (msg: string, dur?: number) => useToastStore.getState().addToast(msg, 'info', dur),
  success: (msg: string, dur?: number) => useToastStore.getState().addToast(msg, 'success', dur),
  warn: (msg: string, dur?: number) => useToastStore.getState().addToast(msg, 'warning', dur),
  error: (msg: string, dur?: number) => useToastStore.getState().addToast(msg, 'error', dur),
}
