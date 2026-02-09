import { SignInButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { TeamClient } from "./TeamClient";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const { userId, orgId } = await auth();

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_15%_-10%,#cffafe_0%,transparent_55%),radial-gradient(900px_circle_at_85%_0%,#fde68a_0%,transparent_50%),linear-gradient(180deg,#fafafa_0%,#ffffff_55%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">TEAM</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Sign in to manage organizations</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Create an org, invite teammates, and share project memory across members.
            </p>
            <div className="mt-6">
              <SignInButton mode="modal">
                <button className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800">
                  Sign in
                </button>
              </SignInButton>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <TeamClient hasOrg={Boolean(orgId)} />;
}

