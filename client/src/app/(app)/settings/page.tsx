import { redirect } from 'next/navigation';

/** /settings opens the first tab. */
export default function SettingsPage() {
  redirect('/settings/account');
}
