import { redirect } from 'next/navigation';

/* 新規登録は本システムでは行わない（職員は管理者からの招待で追加される）。
   旧 SaaS 時代の自己登録ページはルート維持のため残してあるが、即 /login にリダイレクトする。 */
export default function RegisterPage() {
  redirect('/login');
}
