import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import StateMessage from '../components/StateMessage';
import { SETUP_FACTS_QUERY_KEY, fetchSetupFacts } from '../lib/setupApi';
import { setupTodos } from '../lib/setupFlow';

// staleTime 0: coming back from /setup must show the step as done, not the copy cached before it.
export default function SetupTodos() {
  const facts = useQuery({ queryKey: SETUP_FACTS_QUERY_KEY, queryFn: fetchSetupFacts, staleTime: 0, retry: false });
  if (facts.isError) {
    return <StateMessage kind="error" className="mt-6" onRetry={() => void facts.refetch()}>We could not load your setup to-dos.</StateMessage>;
  }
  const todos = facts.data ? setupTodos(facts.data) : [];
  if (todos.length === 0) return null;

  return (
    <section aria-labelledby="setup-todos-heading" className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
      <h2 id="setup-todos-heading" className="text-sm font-medium text-gray-700">Finish setting up</h2>
      <ul className="mt-3 divide-y divide-gray-200">
        {todos.map((todo) => (
          <li key={todo.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-medium text-gray-900">{todo.title}</p>
              <p className="text-sm text-gray-700">{todo.sentence}</p>
            </div>
            <Link to={todo.link} className="inline-flex min-h-11 min-w-11 items-center rounded-md border border-gray-400 px-4 text-gray-900 hover:bg-gray-100">
              Do this now
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
