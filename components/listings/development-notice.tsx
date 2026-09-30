// RETIRED in Phase 4: retained only until hosted Supabase acceptance checks pass.
// No active marketplace code may import this development implementation.
export function DevelopmentNotice() {
  return (
    <p className="text-neutral-dark text-sm">
      Temporary development mode: listings you post are shared under one demo
      seller and kept only until this server restarts.
    </p>
  )
}
