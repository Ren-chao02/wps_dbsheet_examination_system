import axios from 'axios';
import type { SchemaRefs } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// Request interceptor: attach JWT
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        // 考试中遇到 401（服务端重启换密钥/账号被禁用）会整页跳走、丢失当前题与切屏计数。
        // 这里先把当前 URL 存进 sessionStorage，登录成功后跳回（key: login_return_url，
        // 由 LoginPage 消费：登录成功后读取并清除、navigate 回去，未接入前只存不用）。
        try {
          sessionStorage.setItem(
            'login_return_url',
            window.location.pathname + window.location.search + window.location.hash
          );
        } catch {
          // 隐私模式下 sessionStorage 可能不可用：忽略，仅丢失回跳能力
        }
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// ============================================================
// 题库练习（实操模式）
// ============================================================

export const practiceApi = {
  /** 查询当前学生的练习文件注册 */
  getAssignment: () => api.get('/practice/assignment').then(r => r.data),

  /** 注册/更新练习文件（教师/管理员代学生注册） */
  registerAssignment: (data: { fileId: string; shareUrl?: string; accessToken?: string }) =>
    api.post('/practice/assignment', data).then(r => r.data),

  /** 获取分类/难度目录 */
  getCatalog: () => api.get('/practice/questions/catalog').then(r => r.data),

  /** 场景实战卡片列表（只含题数 ≥ 2 的场景 + 该生进度） */
  scenarios: () => api.get('/practice/scenarios'),

  /** 开练：按分类/难度随机抽题，或个人题集按指定题目（questionIds）组卷 */
  start: (data: {
    primaryCategoryId?: string;
    secondaryCategoryId?: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    count?: number;
    questionIds?: string[];
  }) => api.post('/practice/start', data).then(r => r.data),

  /** 提交练习并判分 */
  submit: (recordId: string) =>
    api.post(`/practice/${recordId}/submit`).then(r => r.data),

  /** 练习历史 */
  history: () => api.get('/practice/history').then(r => r.data),

  /** 切换收藏：返回 { favorited: boolean } */
  toggleFavorite: (questionId: string) =>
    api.post('/practice/favorite', { questionId }).then(r => r.data),

  /** 我的收藏列表 */
  favorites: () => api.get('/practice/favorite').then(r => r.data),

  /** 错题本列表 */
  wrongQuestions: () => api.get('/practice/wrong').then(r => r.data),
};

// ============================================================
// 题库（出题辅助）
// ============================================================

export const questionApi = {
  /**
   * 从判分规则推导前置契约（出题页「自动推导」按钮，POST /api/questions/derive-refs）。
   * 服务端纯函数、不查库不联网；推不出的 action 在 unresolved 里点名交人工。
   * 返回整个 AxiosResponse（调用方取 res.data.refs / res.data.unresolved）。
   */
  deriveRefs: (payload: {
    rules: Array<{ id?: string; action: string; params?: Record<string, unknown>; score?: number }>;
    // 题面必须一起送：服务端靠它判 check_table_exists 是"真建表"还是"前置检查"，
    // 不传会把所有建表题都保守判成前置检查（requires 平白多出一张表、creates 恒空）
    title?: string;
    description?: string;
  }) => api.post<{ refs: SchemaRefs; unresolved: string[] }>('/questions/derive-refs', payload),
};
