import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { redirect } from 'next/navigation';

const key = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return new TextEncoder().encode(secret);
};
export function isAllowed(email: string) {
  return (process.env.EMAILS_ALLOWED || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase());
}
export async function createToken(email: string) {
  return new SignJWT({ email }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(key());
}
export async function getUser() {
  const token = (await cookies()).get('session')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    const email = payload.email;
    return typeof email === 'string' && isAllowed(email) ? email : null;
  } catch { return null; }
}
export async function requireUser() {
  const email = await getUser();
  if (!email) redirect('/login');
  return email;
}
