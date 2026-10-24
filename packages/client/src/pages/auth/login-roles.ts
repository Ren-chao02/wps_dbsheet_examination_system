/** 登录页的身份入口。只是输入引导，不参与后端鉴权。 */
export type LoginRole = 'student' | 'teacher' | 'admin';

export const DEFAULT_LOGIN_ROLE: LoginRole = 'student';

/** 记住上次选中的身份；下次打开登录页直接落在这个入口 */
export const LOGIN_ROLE_STORAGE_KEY = 'login_last_role';

/** 改版前的单一账号记忆键，读到后按当前身份兜底 */
export const LEGACY_IDENTIFIER_STORAGE_KEY = 'login_last_identifier';

export interface LoginRoleHelp {
  forgotPassword: string;
  locked: string;
  noAccount: string;
  footer: string;
}

export interface LoginRoleMeta {
  label: string;
  identifierLabel: string;
  identifierPlaceholder: string;
  identifierRequired: string;
  subtitle: string;
  footerNote: string;
  showInvitation: boolean;
  showWpsSso: boolean;
  lockAlertHint: string;
  help: LoginRoleHelp;
}

/**
 * 每个身份只改「怎么填、找谁帮忙、还有哪些入口」，不改登录接口。
 * 学生可走邀请入班和 WPS；管理员是系统账号，两条都不适用。
 */
const LOGIN_ROLE_META: Record<LoginRole, LoginRoleMeta> = {
  student: {
    label: '学生',
    identifierLabel: '学号',
    identifierPlaceholder: '请输入学号',
    identifierRequired: '请输入学号',
    subtitle: '使用学号登录 · 账号由教师开通',
    footerNote: '学生账号通过班级邀请链接开通',
    showInvitation: true,
    showWpsSso: true,
    lockAlertHint: '也可联系管理员立即解锁。',
    help: {
      forgotPassword: '请联系任课教师或系统管理员重置，系统暂不支持自助找回。',
      locked: '连续失败 10 次会锁定 15 分钟，等待自动解锁，或联系管理员立即解锁。',
      noAccount: '请向任课教师索取班级邀请链接，通过邀请链接入班后即可登录。',
      footer: '如需帮助，请联系学校考试系统管理员。',
    },
  },
  teacher: {
    label: '教师',
    identifierLabel: '工号',
    identifierPlaceholder: '请输入工号',
    identifierRequired: '请输入工号',
    subtitle: '使用工号登录 · 账号由管理员开通',
    footerNote: '教师账号由管理员开通',
    showInvitation: false,
    showWpsSso: true,
    lockAlertHint: '也可联系管理员立即解锁。',
    help: {
      forgotPassword: '请联系学校管理员重置，系统暂不支持自助找回。',
      locked: '连续失败 10 次会锁定 15 分钟，等待自动解锁，或联系管理员立即解锁。',
      noAccount: '教师账号由学校管理员开通，请联系管理员。',
      footer: '如需帮助，请联系学校考试系统管理员。',
    },
  },
  admin: {
    label: '管理员',
    identifierLabel: '系统账号',
    identifierPlaceholder: '请输入系统账号',
    identifierRequired: '请输入系统账号',
    subtitle: '使用系统账号登录 · 仅限授权管理员',
    footerNote: '管理员账号由系统运维维护',
    showInvitation: false,
    showWpsSso: false,
    lockAlertHint: '也可联系系统运维立即解锁。',
    help: {
      forgotPassword: '请联系系统运维或其他管理员重置，系统暂不支持自助找回。',
      locked: '连续失败 10 次会锁定 15 分钟，等待自动解锁，或联系系统运维立即解锁。',
      noAccount: '管理员账号由系统运维开通，请联系部署维护人员。',
      footer: '如需帮助，请联系系统运维。',
    },
  },
};

export function getLoginRoleMeta(role: LoginRole): LoginRoleMeta {
  return LOGIN_ROLE_META[role];
}

/** localStorage 里可能是旧值/脏值，统一落到学生入口 */
export function normalizeLoginRole(value: unknown): LoginRole {
  if (value === 'student' || value === 'teacher' || value === 'admin') {
    return value;
  }
  return DEFAULT_LOGIN_ROLE;
}

export function identifierStorageKey(role: LoginRole): string {
  return `login_remembered_identifier_${role}`;
}

/**
 * 优先读当前身份自己的记录；没有时兼容改版前的单一账号。
 * 兼容值不在这里迁移，等真正登录成功后再按账号真实角色写入。
 */
export function readRememberedIdentifier(
  role: LoginRole,
  storage: Pick<Storage, 'getItem'>,
): string {
  return (
    storage.getItem(identifierStorageKey(role)) ??
    storage.getItem(LEGACY_IDENTIFIER_STORAGE_KEY) ??
    ''
  );
}
