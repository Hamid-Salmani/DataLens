import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  description?: string
}

interface SelectProps {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  searchable?: boolean
  placeholder?: string
}

export function Select({
  label,
  value,
  options,
  onChange,
  searchable = false,
  placeholder = 'Choose an option',
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const typeaheadRef = useRef('')
  const listId = `select-${useId()}`
  const filteredOptions = options.filter((option) => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const selected = options.find((option) => option.value === value)
  const enabledIndices = filteredOptions.flatMap((option, index) => option.disabled ? [] : [index])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const choose = (option: SelectOption) => {
    if (option.disabled) return
    onChange(option.value)
    setOpen(false)
    setQuery('')
  }

  const moveActive = (direction: 1 | -1) => {
    if (enabledIndices.length === 0) return
    const current = enabledIndices.indexOf(activeIndex)
    const next = current < 0
      ? enabledIndices[0] ?? 0
      : enabledIndices[(current + direction + enabledIndices.length) % enabledIndices.length] ?? 0
    setActiveIndex(next)
    rootRef.current?.querySelector<HTMLElement>(`[data-option-index="${next}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement | HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)))
      } else {
        moveActive(event.key === 'ArrowDown' ? 1 : -1)
      }
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      const option = filteredOptions[activeIndex]
      if (option) choose(option)
    } else if (event.key === 'Escape') {
      setOpen(false)
      setQuery('')
    } else if (event.key === 'Home' && open) {
      event.preventDefault()
      setActiveIndex(enabledIndices[0] ?? 0)
    } else if (event.key === 'End' && open) {
      event.preventDefault()
      setActiveIndex(enabledIndices[enabledIndices.length - 1] ?? 0)
    } else if (!searchable && event.key.length === 1 && /\S/.test(event.key)) {
      typeaheadRef.current += event.key.toLocaleLowerCase()
      const match = options.findIndex((option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(typeaheadRef.current))
      if (match >= 0) {
        setActiveIndex(match)
        if (open) choose(options[match]!)
      }
      window.setTimeout(() => { typeaheadRef.current = '' }, 700)
    }
  }

  const openMenu = () => {
    setOpen(true)
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)))
    if (searchable) requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <div className="relative w-full min-w-0" ref={rootRef}>
      {searchable ? (
        <input
          ref={inputRef}
          className="min-h-10 w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-activedescendant={open ? `${listId}-option-${activeIndex}` : undefined}
          value={open ? query : selected?.label ?? ''}
          placeholder={placeholder}
          onFocus={() => { if (!open) { setQuery(''); setOpen(true) } }}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
            setOpen(true)
          }}
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget)) setOpen(false)
          }}
        />
      ) : (
        <button
          type="button"
          className="flex min-h-10 w-full items-center justify-between gap-2.5 overflow-hidden rounded-lg border border-border bg-surface px-2.5 py-2 text-left font-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-activedescendant={open ? `${listId}-option-${activeIndex}` : undefined}
          onClick={() => open ? setOpen(false) : openMenu()}
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget)) setOpen(false)
          }}
        >
          <span>{selected?.label ?? placeholder}</span>
          <span className="shrink-0 text-muted" aria-hidden="true">⌄</span>
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-[calc(100%+5px)] z-20 max-h-[260px] w-[max(100%,190px)] overflow-auto rounded-lg border border-border bg-surface p-1 shadow-xl" id={listId} role="listbox" aria-label={label}>
          {filteredOptions.length > 0 ? filteredOptions.map((option, index) => (
            <button
              type="button"
              role="option"
              id={`${listId}-option-${index}`}
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              tabIndex={-1}
              className={`grid min-h-9 w-full justify-start rounded-md border-0 px-2 py-1.5 text-left font-normal text-foreground ${
                index === activeIndex ? 'bg-primary/10' : 'bg-transparent'
              } ${option.disabled ? 'cursor-not-allowed text-muted opacity-65' : 'hover:bg-primary/10'}`}
              data-option-index={index}
              key={option.value}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
              title={option.description}
            >
              <span>{option.label}</span>
              {option.description && <small className="text-[0.7rem] text-muted">{option.description}</small>}
            </button>
          )) : <p className="m-0 p-2.5 text-xs text-muted">No matching options</p>}
        </div>
      )}
    </div>
  )
}
