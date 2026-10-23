/** 登录后的角色首页 */
export function roleHome(role: string): string {
  if (role === 'student') return '/student';
  if (role === 'admin') return '/admin';
  return '/teacher';
}

/**
 * 取出并清除「会话过期前的位置」。
 * 只接受站内绝对路径，避免被外部 URL 利用成开放重定向。
 */
export function takeLoginReturnUrl(): string | null {
  const url = sessionStorage.getItem('login_return_url');
  sessionStorage.removeItem('login_return_url');
  return url && url.startsWith('/') ? url : null;
}
