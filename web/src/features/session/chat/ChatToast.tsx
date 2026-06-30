import { useEffect, useRef, useState } from 'react'

let toastHandler: ((msg: string) => void) | null = null

export function showToast(message: string): void {
  if (toastHandler) {
    toastHandler(message)
  }
}

export function ChatToast(): JSX.Element {
  const [message, setMessage] = useState('')
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    toastHandler = (msg: string) => {
      setMessage(msg)
      setVisible(true)
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
      timerRef.current = window.setTimeout(() => {
        setVisible(false)
      }, 2200)
    }
    return () => {
      toastHandler = null
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  return (
    <div
      id="chat-toast"
      className={`chat-toast ${visible ? 'show' : ''}`}
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
    >
      {message}
    </div>
  )
}

export default ChatToast
