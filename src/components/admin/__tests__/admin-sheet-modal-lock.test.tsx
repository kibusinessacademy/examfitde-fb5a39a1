import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { AdminSheet, AdminSheetContent } from '../AdminSheet';

// Mock the Radix sheet primitives
vi.mock('@/components/ui/sheet', () => {
  const React = require('react');
  return {
    Sheet: ({ children, ...props }: any) => {
      // Track modal prop on body for assertion
      if (props.modal !== false) {
        document.body.style.pointerEvents = 'none';
      }
      return React.createElement('div', { 'data-testid': 'sheet', 'data-modal': String(props.modal) }, children);
    },
    SheetContent: ({ children, className, ...props }: any) => 
      React.createElement('div', { 'data-testid': 'sheet-content', className }, children),
    SheetHeader: ({ children }: any) => React.createElement('div', null, children),
    SheetTitle: ({ children }: any) => React.createElement('div', null, children),
    SheetDescription: ({ children }: any) => React.createElement('div', null, children),
    SheetTrigger: ({ children }: any) => React.createElement('div', null, children),
    SheetClose: ({ children }: any) => React.createElement('div', null, children),
    SheetFooter: ({ children }: any) => React.createElement('div', null, children),
  };
});

describe('AdminSheet', () => {
  it('always passes modal={false} to underlying Sheet', () => {
    const { getByTestId } = render(
      <AdminSheet open={true} onOpenChange={() => {}}>
        <AdminSheetContent>
          <div>Test content</div>
        </AdminSheetContent>
      </AdminSheet>
    );

    const sheet = getByTestId('sheet');
    expect(sheet.getAttribute('data-modal')).toBe('false');
  });

  it('does not leave body pointer-events locked', async () => {
    document.body.style.pointerEvents = '';

    const { rerender } = render(
      <AdminSheet open={true} onOpenChange={() => {}}>
        <AdminSheetContent>Content</AdminSheetContent>
      </AdminSheet>
    );

    expect(document.body.style.pointerEvents).toBe('');

    rerender(
      <AdminSheet open={false} onOpenChange={() => {}}>
        <AdminSheetContent>Content</AdminSheetContent>
      </AdminSheet>
    );

    await waitFor(() => {
      expect(document.body.style.pointerEvents).toBe('');
    });
  });

  it('AdminSheetContent includes overflow-y-auto by default', () => {
    const { getByTestId } = render(
      <AdminSheet open={true} onOpenChange={() => {}}>
        <AdminSheetContent>Content</AdminSheetContent>
      </AdminSheet>
    );

    const content = getByTestId('sheet-content');
    expect(content.className).toContain('overflow-y-auto');
  });
});
