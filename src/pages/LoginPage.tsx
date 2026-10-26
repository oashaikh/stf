import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { LegalLinks } from "./LegalPages";
import {
  SESSION_QUERY_KEY,
  login,
  submitMfaCode,
  type LoginResult,
  type MfaResult,
} from "../lib/session";

const MESSAGES: Record<
  Exclude<LoginResult | MfaResult, "ok" | "code-required">,
  string
> = {
  "wrong-code": "That code is not right.",
  "wrong-password": "That password is not right.",
  locked: "Too many failed attempts. Try again in 15 minutes.",
  error: "Could not sign in. Please try again.",
};

export default function LoginPage() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [codeStep, setCodeStep] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<keyof typeof MESSAGES | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    const result = codeStep
      ? await submitMfaCode(code.trim())
      : await login(password);
    setSubmitting(false);
    setPassword("");
    setCode("");
    setFailure(null);
    if (result === "ok") {
      queryClient.setQueryData(SESSION_QUERY_KEY, true);
    } else if (result === "code-required") {
      setCodeStep(true);
    } else {
      setFailure(result);
    }
  }

  const focusRing =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold text-brand">STF</h1>
      <form onSubmit={submit} className="mt-6">
        {codeStep ? (
          <>
            <label
              htmlFor="owner-code"
              className="block text-sm font-medium text-gray-900"
            >
              {useRecovery ? "Recovery code" : "Authenticator code"}
            </label>
            <input
              id="owner-code"
              type="text"
              inputMode={useRecovery ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className={`mt-2 min-h-[44px] w-full rounded-md border border-gray-400 px-3 ${focusRing}`}
            />
            <button
              type="button"
              onClick={() => setUseRecovery(!useRecovery)}
              className={`mt-2 min-h-[44px] text-sm text-brand underline ${focusRing}`}
            >
              {useRecovery
                ? "Use an authenticator code instead"
                : "Use a recovery code instead"}
            </button>
          </>
        ) : (
          <>
            <label
              htmlFor="owner-password"
              className="block text-sm font-medium text-gray-900"
            >
              Password
            </label>
            <input
              id="owner-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 min-h-[44px] w-full rounded-md border border-gray-400 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            />
          </>
        )}
        {failure && (
          <p role="alert" className="mt-2 text-red-800">
            {MESSAGES[failure]}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="mt-4 min-h-[44px] w-full rounded-md bg-brand px-4 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          {codeStep ? "Verify" : "Sign in"}
        </button>
      </form>
      <footer className="mt-8">
        <LegalLinks />
      </footer>
    </main>
  );
}
