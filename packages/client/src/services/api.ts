import axios from 'axios';

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

  /** 开练：抽题 + 重置文件 + 建记录 */
  start: (data: {
    primaryCategoryId?: string;
    secondaryCategoryId?: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    count?: number;
  }) => api.post('/practice/start', data).then(r => r.data),

  /** 提交练习并判分 */
  submit: (recordId: string) =>
    api.post(`/practice/${recordId}/submit`).then(r => r.data),

  /** 练习历史 */
  history: () => api.get('/practice/history').then(r => r.data),
};
