import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// The owner replaces this before the pages are given to HMRC.
const CONTACT_EMAIL = 'CONTACT-EMAIL-TO-BE-ADDED';

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8 text-gray-900">
      <p>
        <Link to="/" className="inline-flex min-h-[44px] items-center text-blue-700 underline">Back to STF</Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-brand">{title}</h1>
      <p className="mt-2 text-gray-700">Last updated 26 October 2026.</p>
      <div className="mt-6 space-y-6">{children}</div>
    </main>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">{heading}</h2>
      <div className="mt-2 space-y-2 text-gray-800">{children}</div>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <Section heading="Who runs STF">
        <p>
          STF is a bookkeeping and VAT tool for one owner. It is run by OJ Labs Ltd, who decide what is stored and why.
          Questions about your data: {CONTACT_EMAIL}.
        </p>
      </Section>
      <Section heading="What STF stores">
        <ul className="list-disc space-y-1 pl-6">
          <li>Your ledger: transactions, invoices, receipts and the details you type in.</li>
          <li>Your VAT returns: drafts, confirmed figures and the receipts HMRC gives back, plus your VAT number.</li>
          <li>Your HMRC connection tokens. They are encrypted before they are saved.</li>
          <li>Login attempts, kept only to lock the login after too many wrong passwords.</li>
        </ul>
        <p>STF does not use advertising or analytics trackers.</p>
      </Section>
      <Section heading="Where it is kept">
        <p>
          The database is hosted by Neon in London. The app runs on Vercel. Receipt images you upload are read by
          Anthropic's Claude to suggest the details; the result is only ever a draft until you confirm it.
        </p>
      </Section>
      <Section heading="What is sent to HMRC, and why">
        <p>
          When you connect HMRC, file a VAT return or view one, STF sends HMRC your VAT number and the nine box figures
          so the return can be filed or shown. Nothing is filed until you confirm it.
        </p>
        <p>
          HMRC also requires fraud prevention headers with each request. These describe the device and connection you
          are using: a device ID kept in your browser, your time zone, screen and window size, browser name and the IP
          address you connect from. HMRC uses them to spot fraud.
        </p>
      </Section>
      <Section heading="How long it is kept">
        <p>
          Ledger and VAT records are kept for as long as you use STF, because HMRC expects VAT records to be kept for at
          least six years. Login attempts are removed once they are too old to count towards a lockout. Deleted
          financial records are marked as deleted rather than erased, so the audit trail stays complete.
        </p>
      </Section>
      <Section heading="Deleting your data">
        <p>
          Email {CONTACT_EMAIL} and we will delete your data, including uploaded receipts and your stored HMRC tokens.
          Records HMRC already holds cannot be removed by us. To stop STF using your HMRC connection, you can also
          remove STF under your Government Gateway account.
        </p>
      </Section>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <Section heading="What STF is">
        <p>
          STF is a bookkeeping and VAT tool run by OJ Labs Ltd for a single owner. It is not open to the public and it
          is not accountancy or tax advice.
        </p>
      </Section>
      <Section heading="Your responsibility for what you file">
        <p>
          STF works out VAT boxes from the records you enter and shows them to you first. You must check them.
          Nothing is sent to HMRC until you confirm it, and you are responsible for the figures you file.
        </p>
      </Section>
      <Section heading="Test and live mode">
        <p>
          STF starts in HMRC's test (sandbox) mode, where nothing you file counts. Live filing needs both the server to
          be set to live and your own opt-in in Settings.
        </p>
      </Section>
      <Section heading="Availability">
        <p>
          We try to keep STF running but do not promise it will always be available. If HMRC or our hosts have a
          problem, filing may be delayed. Check your deadlines and keep your own copy of your records.
        </p>
      </Section>
      <Section heading="Your data">
        <p>How we handle your data is set out in the <Link to="/privacy" className="text-blue-700 underline">privacy policy</Link>.</p>
      </Section>
      <Section heading="Contact">
        <p>Questions about these terms: {CONTACT_EMAIL}.</p>
      </Section>
    </LegalPage>
  );
}

export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex gap-4 ${className}`}>
      <Link to="/privacy" className="inline-flex min-h-[44px] items-center text-blue-700 underline">Privacy policy</Link>
      <Link to="/terms" className="inline-flex min-h-[44px] items-center text-blue-700 underline">Terms of use</Link>
    </nav>
  );
}
