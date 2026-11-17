import type { Metadata } from 'next';
import { ResetRequestForm } from '@/components/auth/reset-forms';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ResetPasswordPage() {
  return <ResetRequestForm />;
}
