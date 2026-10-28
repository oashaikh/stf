// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { VatPreview } from '../lib/hmrc/vatApi';
import VatPreviewPanel from './VatPreviewPanel';

const preview: VatPreview = {
  endpoint: { method: 'POST', url: 'https://test-api.service.hmrc.gov.uk/organisations/vat/XXXXXX789/returns', sandbox: true },
  body: {
    periodKey: '26C3',
    vatDueSales: 120.5,
    vatDueAcquisitions: 0,
    totalVatDue: 120.5,
    vatReclaimedCurrPeriod: 20,
    netVatDue: 100.5,
    totalValueSalesExVAT: 602,
    totalValuePurchasesExVAT: 100,
    totalValueGoodsSuppliedExVAT: 0,
    totalAcquisitionsExVAT: 0,
    finalised: true,
  },
  headers: { Authorization: 'Bearer (hidden)', 'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER' },
};

afterEach(cleanup);

describe('VatPreviewPanel', () => {
  it('shows the endpoint, nine box rows with fixed two-decimal amounts, headers and raw JSON', () => {
    render(<VatPreviewPanel preview={preview} />);
    expect(screen.getByText(/Sent to the HMRC test service/)).toBeInTheDocument();
    expect(screen.getByText(/XXXXXX789/)).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(9);
    expect(within(rows[0]).getByText('VAT due on sales')).toBeInTheDocument();
    expect(within(rows[0]).getByText('£120.50')).toBeInTheDocument();
    expect(within(rows[5]).getByText('£602.00')).toBeInTheDocument();
    expect(screen.getByText('Bearer (hidden)')).toBeInTheDocument();
    expect(screen.getByText(/confirmed/)).toBeInTheDocument();
    const raw = screen.getByText('Raw JSON').closest('details')!;
    expect(raw).not.toHaveAttribute('open');
    expect(raw.textContent).toContain('"periodKey": "26C3"');
  });

  it('groups thousands like the rest of the page', () => {
    const big = { ...preview, body: { ...preview.body, totalValueSalesExVAT: 6002 } };
    render(<VatPreviewPanel preview={big} />);
    expect(screen.getByText('£6,002.00')).toBeInTheDocument();
  });

  it('renders a nil return as zero amounts', () => {
    const nil = { ...preview, body: { ...preview.body, vatDueSales: 0, totalVatDue: 0, vatReclaimedCurrPeriod: 0, netVatDue: 0, totalValueSalesExVAT: 0, totalValuePurchasesExVAT: 0 } };
    render(<VatPreviewPanel preview={nil} />);
    expect(screen.getAllByText('£0.00')).toHaveLength(9);
  });

  it('labels box 5 as a payment when VAT due exceeds VAT reclaimed', () => {
    render(<VatPreviewPanel preview={preview} />);
    expect(screen.getByText('Sent to HMRC as £100.50 (payment)')).toBeInTheDocument();
  });

  it('labels box 5 as a refund while still sending the unsigned amount', () => {
    const refund = { ...preview, body: { ...preview.body, totalVatDue: 20, vatReclaimedCurrPeriod: 65, netVatDue: 45 } };
    render(<VatPreviewPanel preview={refund} />);
    const row = screen.getAllByRole('row')[5];
    expect(within(row).getByText('£45.00')).toBeInTheDocument();
    expect(within(row).getByText('Sent to HMRC as £45.00 (refund)')).toBeInTheDocument();
  });
});
