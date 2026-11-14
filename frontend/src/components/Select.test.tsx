import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Select } from './Select'

describe('Select', () => {
  afterEach(() => cleanup())

  it('supports keyboard navigation and choosing an option', () => {
    const onChange = vi.fn()
    render(<Select
      label="Aggregation"
      value="count"
      onChange={onChange}
      options={[
        { value: 'count', label: 'Count' },
        { value: 'avg', label: 'Average' },
        { value: 'sum', label: 'Sum' },
      ]}
    />)

    const trigger = screen.getByRole('combobox', { name: 'Aggregation' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('avg')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('searches options in combobox mode and does not choose disabled options', () => {
    const onChange = vi.fn()
    render(<Select
      label="Column"
      value=""
      searchable
      onChange={onChange}
      options={[
        { value: '1', label: 'Revenue · decimal' },
        { value: '2', label: 'Customer · text', disabled: true, description: 'Requires a numeric column' },
      ]}
    />)

    const input = screen.getByRole('combobox', { name: 'Column' })
    fireEvent.change(input, { target: { value: 'Customer' } })
    expect(screen.getByRole('option', { name: /Customer · text/ })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('option', { name: /Customer · text/ }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Revenue' } })
    fireEvent.click(screen.getByRole('option', { name: /Revenue · decimal/ }))
    expect(onChange).toHaveBeenCalledWith('1')
  })
})
