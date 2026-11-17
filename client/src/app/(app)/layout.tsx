import { AppShell } from '@/components/shell';
import { pageCtx } from '@/server/services/page-context';

/** Every signed-in page: logged-out visitors go to /log-in. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await pageCtx();
  return <AppShell user={ctx.user}>{children}</AppShell>;
}
