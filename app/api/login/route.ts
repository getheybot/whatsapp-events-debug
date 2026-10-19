import { NextRequest, NextResponse } from 'next/server';
import { createToken, isAllowed } from '../../../lib/auth';
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get('email') || '').trim().toLowerCase();
  if (!email || !isAllowed(email)) return NextResponse.redirect(new URL('/login?error=1', request.url), 303);
  const response = NextResponse.redirect(new URL('/dashboard', request.url), 303);
  response.cookies.set('session', await createToken(email), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
  return response;
}
