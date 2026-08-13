import { useEffect, useState } from 'react'
import type { AskAnswer, AskInfo } from '../../api/types'
import './AskUserModal.css'

export interface AskUserModalProps {
  ask: AskInfo | null
  loading: boolean
  error: string | null
  onSubmit: (answers: AskAnswer[]) => void
  onClose: () => void
}

export function AskUserModal({ ask, loading, error, onSubmit, onClose }: AskUserModalProps): JSX.Element | null {
  const [selectedOptionIndexes, setSelectedOptionIndexes] = useState<Set<number>>(new Set())
  const [customAnswer, setCustomAnswer] = useState('')

  useEffect(() => {
    setSelectedOptionIndexes(new Set())
    setCustomAnswer('')
  }, [ask?.id])

  useEffect(() => {
    if (!ask || loading) {
      return
    }

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleDocumentKeyDown)
    return () => document.removeEventListener('keydown', handleDocumentKeyDown)
  }, [ask, loading, onClose])

  if (!ask) {
    return null
  }

  const options = ask.options ?? []
  const hasOptions = options.length > 0
  const canSubmitCustomAnswer = customAnswer.trim().length > 0
  const canSubmitSelection = selectedOptionIndexes.size > 0

  const submitAnswers = (answers: AskAnswer[]) => {
    if (!loading && answers.length > 0) {
      onSubmit(answers)
    }
  }

  const handleOptionClick = (index: number) => {
    const option = options[index]
    if (!option || loading) {
      return
    }

    if (!ask.multiSelect) {
      submitAnswers([{ question: ask.question, answer: option.value ?? option.label }])
      return
    }

    setSelectedOptionIndexes((current) => {
      const next = new Set(current)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const handleSubmit = () => {
    if (hasOptions && ask.multiSelect) {
      const answers = Array.from(selectedOptionIndexes)
        .sort((a, b) => a - b)
        .map((index) => options[index])
        .filter((option): option is (typeof options)[number] => option !== undefined)
        .map((option) => ({ question: ask.question, answer: option.value ?? option.label }))
      submitAnswers(answers)
      return
    }

    if (!hasOptions && canSubmitCustomAnswer) {
      submitAnswers([{ question: ask.question, answer: customAnswer.trim() }])
    }
  }

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!loading && event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className="modal-overlay"
      data-testid="ask-user-modal"
      onClick={handleBackdropClick}
      tabIndex={-1}
      role="presentation"
    >
      <div
        className="modal-content ask-user-modal__content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-user-modal-title"
      >
        <div className="modal-header">
          <h4 id="ask-user-modal-title">用户提问</h4>
          <button
            type="button"
            data-testid="ask-user-modal-close"
            onClick={onClose}
            disabled={loading}
            className="modal-close"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="modal-body ask-user-modal__body">
          <p className="ask-user-modal__question">{ask.question}</p>
          {ask.context && <p className="ask-user-modal__context">{ask.context}</p>}

          {hasOptions ? (
            ask.multiSelect ? (
              <fieldset className="ask-user-modal__options">
                <legend className="sr-only">可选择的回答</legend>
                {options.map((option, index) => (
                  <label className="ask-user-modal__checkbox-option" key={`${option.label}-${index}`}>
                    <input
                      type="checkbox"
                      data-testid={`ask-user-modal-checkbox-${index}`}
                      checked={selectedOptionIndexes.has(index)}
                      onChange={() => handleOptionClick(index)}
                      disabled={loading}
                    />
                    <span className="ask-user-modal__option-copy">
                      <span className="ask-user-modal__option-heading">
                        <span>{option.label}</span>
                        {index === 0 && <span className="ask-user-modal__recommended">推荐</span>}
                      </span>
                      {option.description && <span className="ask-user-modal__description">{option.description}</span>}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <div className="ask-user-modal__options" role="group" aria-label="可选择的回答">
                {options.map((option, index) => (
                  <button
                    type="button"
                    key={`${option.label}-${index}`}
                    data-testid={`ask-user-modal-option-${index}`}
                    className={`ask-user-modal__option${index === 0 ? ' ask-user-modal__option--recommended' : ''}`}
                    onClick={() => handleOptionClick(index)}
                    disabled={loading}
                  >
                    <span className="ask-user-modal__option-copy">
                      <span className="ask-user-modal__option-heading">
                        <span>{option.label}</span>
                        {index === 0 && <span className="ask-user-modal__recommended">推荐</span>}
                      </span>
                      {option.description && <span className="ask-user-modal__description">{option.description}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : (
            <div className="ask-user-modal__custom-answer">
              <label htmlFor="ask-user-modal-custom-answer">自定义回答</label>
              <input
                id="ask-user-modal-custom-answer"
                type="text"
                value={customAnswer}
                onChange={(event) => setCustomAnswer(event.target.value)}
                disabled={loading}
                className="input-field"
                placeholder="请输入回答"
              />
            </div>
          )}

          {error && <div className="ask-user-modal__error">{error}</div>}

          {(ask.multiSelect || !hasOptions) && (
            <div className="ask-user-modal__actions">
              <button
                type="button"
                data-testid="ask-user-modal-submit"
                className="primary-button ask-user-modal__submit"
                onClick={handleSubmit}
                disabled={loading || (hasOptions && ask.multiSelect ? !canSubmitSelection : !canSubmitCustomAnswer)}
              >
                {loading ? '提交中...' : '提交回答'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
