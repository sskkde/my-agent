import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MemoryTab from './MemoryTab';

describe('MemoryTab', () => {
  it('renders memory management tab with testid', () => {
    render(<MemoryTab />);
    expect(screen.getByTestId('memory-tab')).toBeDefined();
  });

  it('renders search input', () => {
    render(<MemoryTab />);
    expect(screen.getByTestId('memory-search-input')).toBeDefined();
  });

  it('renders loading state initially', () => {
    render(<MemoryTab />);
    expect(screen.getByTestId('memory-loading')).toBeDefined();
  });
});
