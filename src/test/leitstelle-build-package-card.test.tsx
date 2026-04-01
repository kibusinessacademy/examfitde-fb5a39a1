import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { BuildPackageCard } from '@/components/admin/command/BuildPackageCard';

describe('BuildPackageCard', () => {
  it('renders blocked packages as clickable studio links with hover and accessibility support', () => {
    const { getByRole, getByText } = render(
      <MemoryRouter>
        <BuildPackageCard
          packageId="pkg-blocked-1234"
          title="Blockierter Kurs"
          status="blocked"
          badges={[{ label: 'Blockiert', tone: 'red' }]}
        />
      </MemoryRouter>,
    );

    const link = getByRole('link', { name: 'Blockierter Kurs im Studio öffnen' });

    expect(link).toHaveAttribute('href', '/admin/studio/pkg-blocked-1234');
    expect(link).toHaveAttribute('tabindex', '0');
    expect(link).toHaveClass('hover:ring-2', 'hover:scale-[1.01]', 'focus-visible:ring-2');
    expect(getByText('Blockiert')).toBeInTheDocument();
  });
});