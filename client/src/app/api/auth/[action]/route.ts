import { NextResponse } from 'next/server';
import { errors } from '@/contracts/common';
import { clearSessionCookie, publicRoute, setSessionCookie, type PublicRouteArgs } from '@/server/http';
import { auth, users } from '@/server/services';
import type { SignedIn } from '@/server/services/auth';

/**
 * /api/auth/<action>. GET me; POST sign-up, log-in, log-out, check-email, resend-check, request-reset,
 * reset-password, change-password, change-email, confirm-email-change, delete-account.
 */
function signedIn(result: SignedIn, status = 200) {
  return setSessionCookie(NextResponse.json({ user: result.user }, { status }), result.token, result.expiresAt);
}

function needCtx(args: PublicRouteArgs) {
  if (!args.ctx) throw errors.unauthenticated();
  return args.ctx;
}

export const GET = publicRoute(async (args) => {
  if (args.params.action !== 'me') throw errors.notFound('That page');
  return { user: args.ctx ? await users.get(args.ctx) : null, signupsOpen: auth.signupsOpen() };
});

export const POST = publicRoute(async (args) => {
  const { meta } = args;
  switch (args.params.action) {
    case 'sign-up':
      return signedIn(await auth.signUp(await args.body(), meta), 201);
    case 'log-in':
      return signedIn(await auth.logIn(await args.body(), meta));
    case 'log-out':
      await auth.logOut(args.token);
      return clearSessionCookie(new NextResponse(null, { status: 204 }));
    case 'check-email':
      return { user: await auth.checkEmail(await args.body()) };
    case 'resend-check':
      return auth.resendCheck(needCtx(args), meta);
    case 'request-reset':
      return auth.requestReset(await args.body(), meta);
    case 'reset-password':
      return signedIn(await auth.resetPassword(await args.body(), meta));
    case 'change-password':
      await auth.changePassword(needCtx(args), await args.body(), args.token);
      return undefined;
    case 'change-email':
      return auth.requestEmailChange(needCtx(args), await args.body());
    case 'confirm-email-change':
      return { user: await auth.confirmEmailChange(await args.body()) };
    case 'delete-account':
      await auth.deleteAccount(needCtx(args), await args.body());
      return clearSessionCookie(new NextResponse(null, { status: 204 }));
    default:
      throw errors.notFound('That page');
  }
});
