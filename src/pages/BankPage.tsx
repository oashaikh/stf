import BankSection from './BankSection';
import BankSortSection from './BankSortSection';

export default function BankPage() {
  return (
    <main className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Bank</h1>
      <BankSection />
      <BankSortSection />
    </main>
  );
}
