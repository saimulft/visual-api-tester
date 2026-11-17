import { AuthBox } from '@/components/auth/auth-box';
import { AuthFoot } from '@/components/auth/auth-foot';
import { Logo } from '@/components/ui';

/**
 * The account screens (01): the calm form on one side, the dark box with the mini-UI on the other. The box
 * sits in the layout, so it plays once and stays put while people move between these pages.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-side" aria-label="Your account">
        <Logo href="/" />
        {children}
        <AuthFoot />
      </section>
      <AuthBox />
    </div>
  );
}
